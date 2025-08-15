// main.rs - Updated with improved resizing and positioning
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod audio;
mod speech_recognition;
mod wake_word;

use wake_word::WakeWordDetector;
use std::sync::{Arc, Mutex};
use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::PhysicalPosition;
use tauri::{Emitter, Manager, State};
use std::time::Duration;

struct AppState {
    wake_word_detector: Arc<Mutex<Option<WakeWordDetector>>>,
    last_resize_time: Arc<Mutex<std::time::Instant>>,
}

// Helper function to calculate position for given window dimensions at the top center
fn calculate_top_center_position(window: &tauri::WebviewWindow, width: u32) -> Result<PhysicalPosition<i32>, String> {
    if let Ok(monitor) = window.primary_monitor() {
        if let Some(monitor) = monitor {
            let work_area = monitor.work_area();
            
            // Calculate position: centered horizontally, 50px from top of work area
            // Convert all values to i32 for calculations
            let work_x = work_area.position.x;
            let work_y = work_area.position.y;
            let work_width = work_area.size.width as i32;
            let window_width = width as i32;
            
            let x = work_x + (work_width - window_width) / 2;
            let y = work_y + 50; // Position 50px from the top of the work area
            
            return Ok(PhysicalPosition::new(x, y));
        }
    }
    Err("Failed to get monitor information".to_string())
}

#[tauri::command]
async fn start_wake_word_detection(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let detector_guard = state.wake_word_detector.lock().unwrap();
    let detector = detector_guard
        .as_ref()
        .ok_or_else(|| "Wake word detector not initialized".to_string())?;
    
    // Set the app handle so the detector can emit events
    detector.set_app_handle(app.clone());
    
    let app_clone = app.clone();
    
    detector.start_listening(move |keyword_index| {
        // Wake word detected!
        println!("🎯 Wake word detected with index: {}!", keyword_index);
        println!("🎉 HELLO WORLD! WAKE WORD DETECTED! 🎉");
        
        // Show the window with smooth transition
        if let Some(window) = app_clone.get_webview_window("main") {
            // Remove max size constraints
            window.set_max_size(None::<tauri::LogicalSize<f64>>)
                .unwrap_or_else(|e| eprintln!("Failed to remove max size: {:?}", e));

            // Set initial size and position atomically
            let initial_width = 480;
            let initial_height = 320;
            
            // Calculate position first
            if let Ok(position) = calculate_top_center_position(&window, initial_width) {
                // Set size and position together to minimize visual artifacts
                window.set_size(tauri::LogicalSize::new(initial_width as f64, initial_height as f64))
                    .unwrap_or_else(|e| eprintln!("Failed to set initial size: {:?}", e));
                
                window.set_position(position)
                    .unwrap_or_else(|e| eprintln!("Failed to set initial position: {:?}", e));
            }
            window.show().unwrap();
            window.set_focus().unwrap();
            
            // Emit window-shown event after window is properly positioned
            app_clone.emit("window-shown", ()).unwrap();
        }
        
        // Emit an event to the frontend with the keyword index
        let payload = serde_json::json!({ "keyword_index": keyword_index });
        app_clone.emit("wake-word-detected", payload).unwrap();
    });
    Ok(())
}

#[tauri::command]
fn stop_wake_word_detection(state: State<AppState>) -> Result<(), String> {
    let detector_guard = state.wake_word_detector.lock().unwrap();
    if let Some(detector) = detector_guard.as_ref() {
        detector.stop_listening();
        Ok(())
    } else {
        Err("Wake word detector not initialized".to_string())
    }
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle) {
    println!("Hide window command called");
    if let Some(window) = app.get_webview_window("main") {
        app.emit("window-hidden", ()).unwrap();
        window.hide().unwrap();
    }
}

#[tauri::command]
fn show_window(app: tauri::AppHandle) {
    println!("Show window command called");
    if let Some(window) = app.get_webview_window("main") {
        // Remove max size constraints
        window.set_max_size(None::<tauri::LogicalSize<f64>>)
            .unwrap_or_else(|e| eprintln!("Failed to remove max size: {:?}", e));

        // Get current window size or set initial size
        let current_size = window.inner_size().unwrap_or(tauri::PhysicalSize::new(480, 320));
        let width = current_size.width;
        let height = current_size.height;
        
        // Calculate and set position atomically
        if let Ok(position) = calculate_top_center_position(&window, width) {
            window.set_size(tauri::LogicalSize::new(width as f64, height as f64))
                .unwrap_or_else(|e| eprintln!("Failed to set size: {:?}", e));
            
            window.set_position(position)
                .unwrap_or_else(|e| eprintln!("Failed to set position: {:?}", e));
        }
        window.show().unwrap();
        window.set_focus().unwrap();
        
        // Emit window-shown event
        app.emit("window-shown", ()).unwrap();
    }
}

#[tauri::command]
fn resize_window(app: tauri::AppHandle, width: f64, height: f64, state: State<AppState>) {
    // Rate limit resize operations to prevent excessive calls
    {
        let mut last_resize = state.last_resize_time.lock().unwrap();
        let now = std::time::Instant::now();
        if now.duration_since(*last_resize) < Duration::from_millis(100) {
            println!("🚫 Resize rate limited");
            return;
        }
        *last_resize = now;
    }
    
    if let Some(window) = app.get_webview_window("main") {
        // Only resize if window is visible
        if let Ok(true) = window.is_visible() {
            // Remove max size constraints, just use minimums
            let new_width = width.max(350.0); // Min width of 350px
            let new_height = height.max(200.0); // Min height of 200px
            
            // Get current window size for comparison
            let current_size = window.inner_size().unwrap_or(tauri::PhysicalSize::new(400, 300));
            let current_width = current_size.width as f64;
            let current_height = current_size.height as f64;
            
            // Only resize if the size actually changes significantly
            if (current_width - new_width).abs() > 10.0 || (current_height - new_height).abs() > 10.0 {
                println!("📏 Resizing window: {}x{} -> {}x{}", current_width as i32, current_height as i32, new_width as i32, new_height as i32);
                
                // Calculate new position before resizing
                if let Ok(new_position) = calculate_top_center_position(&window, new_width as u32) {
                    // Set size and position atomically to reduce visual artifacts
                    if let Err(e) = window.set_size(tauri::LogicalSize::new(new_width, new_height)) {
                        eprintln!("Failed to resize window: {:?}", e);
                    } else {
                        // Set position immediately after resize
                        if let Err(e) = window.set_position(new_position) {
                            eprintln!("Failed to reposition window: {:?}", e);
                    }
                }
            }
        }
    }
}
}

#[tauri::command]
fn resize_and_position_window(app: tauri::AppHandle, width: f64, height: f64, state: State<AppState>) {
    // Rate limit resize operations to prevent excessive calls
    {
        let mut last_resize = state.last_resize_time.lock().unwrap();
        let now = std::time::Instant::now();
        if now.duration_since(*last_resize) < Duration::from_millis(300) {
            println!("🚫 Resize and position rate limited");
            return;
        }
        *last_resize = now;
    }
    
    if let Some(window) = app.get_webview_window("main") {
        // Only resize if window is visible
        if let Ok(true) = window.is_visible() {
            // Smaller, more refined minimums for minimal design
            let new_width = width.max(480.0); // Smaller min width
            let new_height = height.max(320.0); // Smaller min height
            
            // Get current window size for comparison
            let current_size = window.inner_size().unwrap_or(tauri::PhysicalSize::new(480, 320));
            let current_width = current_size.width as f64;
            let current_height = current_size.height as f64;
            
            // Only resize if the size actually changes significantly
            if (current_width - new_width).abs() > 20.0 || (current_height - new_height).abs() > 20.0 {
                println!("📏 Resizing and positioning window: {}x{} -> {}x{}", current_width as i32, current_height as i32, new_width as i32, new_height as i32);
                
                // Calculate new position for the target size
                if let Ok(new_position) = calculate_top_center_position(&window, new_width as u32) {
                    // First set the position for the new size
                    if let Err(e) = window.set_position(new_position) {
                        eprintln!("❌ Failed to set position: {:?}", e);
                        return;
                    }
                    
                    // Then resize the window - this reduces visual jarring
                    match window.set_size(tauri::LogicalSize::new(new_width, new_height)) {
                        Ok(_) => {
                            // Double-check position after resize to ensure it stays centered
                            std::thread::sleep(Duration::from_millis(50)); // Brief pause
                            if let Ok(final_position) = calculate_top_center_position(&window, new_width as u32) {
                                let _ = window.set_position(final_position);
                            }
                            println!("✅ Window resized and positioned successfully");
                        },
                        Err(e) => {
                            eprintln!("❌ Failed to resize window: {:?}", e);
                        }
                    }
                } else {
                    eprintln!("❌ Failed to calculate new position");
                }
            } else {
                println!("⏭️ Skipping resize - size change too small");
            }
        } else {
            println!("⚠️ Window not visible, skipping resize");
        }
    } else {
        eprintln!("❌ Window not found");
    }
}

#[tauri::command]
fn set_ignore_cursor_events(app: tauri::AppHandle, ignore: bool) {
    if let Some(window) = app.get_webview_window("main") {
        window.set_ignore_cursor_events(ignore).unwrap_or_else(|e| {
            eprintln!("Failed to set ignore cursor events: {:?}", e);
        });
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    println!("Quit app command called");
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let (detector, tooltip) = match WakeWordDetector::new() {
                Ok(detector) => (Some(detector), "Jackson Assistant"),
                Err(e) => {
                    eprintln!("❌ Failed to initialize wake word detector: {}", e);
                    eprintln!("❌ Error details: {:?}", e);
                    (None, "Jackson Assistant (Error)")
                }
            };
            
            app.manage(AppState {
                wake_word_detector: Arc::new(Mutex::new(detector)),
                last_resize_time: Arc::new(Mutex::new(std::time::Instant::now())),
            });
            
            // Create system tray menu with proper IDs
            let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>).unwrap();
            let hide_item = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>).unwrap();
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).unwrap();
            
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&hide_item)
                .separator()
                .item(&quit_item)
                .build()
                .unwrap();
            
            if let Some(window) = app.get_webview_window("main") {
                window.set_ignore_cursor_events(true).unwrap();
            }
            
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip(tooltip)
                .on_menu_event(move |app, event| {
                    println!("Menu event received: {:?}", event);
                    match event.id().as_ref() {
                        "show" => {
                            println!("Show menu item clicked");
                            show_window(app.clone());
                        }
                        "hide" => {
                            println!("Hide menu item clicked");
                            hide_window(app.clone());
                        }
                        "quit" => {
                            println!("Quit menu item clicked");
                            quit_app(app.clone());
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    match event {
                        TrayIconEvent::Click { button, .. } => {
                            // Only show window on left click
                            if button == tauri::tray::MouseButton::Left {
                                println!("Tray icon left clicked");
                                show_window(tray.app_handle().clone());
                            }
                        }
                        TrayIconEvent::DoubleClick { .. } => {
                            println!("Tray icon double-clicked");
                            show_window(tray.app_handle().clone());
                        }
                        _ => {}
                    }
                })
                .build(app)
                .unwrap();
            
            // Hide the main window after setup is complete
            if let Some(window) = app.get_webview_window("main") {
                // Give the window a moment to initialize before hiding
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    window.hide().unwrap();
                });
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_wake_word_detection,
            stop_wake_word_detection,
            hide_window,
            show_window,
            quit_app,
            resize_window,
            resize_and_position_window,
            set_ignore_cursor_events,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}