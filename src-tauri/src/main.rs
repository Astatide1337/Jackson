// main.rs - Fixed with smooth window positioning and fade-in transitions
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

struct AppState {
    wake_word_detector: Arc<Mutex<Option<WakeWordDetector>>>,
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
            if let Ok(Some(monitor)) = window.primary_monitor() {
                let monitor_size = monitor.size();
                let window_size = window.outer_size().unwrap();
                let new_pos = PhysicalPosition {
                    x: (monitor_size.width as i32 - window_size.width as i32) / 2,
                    y: monitor_size.height as i32 - window_size.height as i32 - 40, // 40px buffer from bottom
                };
                window.set_position(new_pos).unwrap();
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
        if let Ok(Some(monitor)) = window.primary_monitor() {
            let monitor_size = monitor.size();
            let window_size = window.outer_size().unwrap();
            let new_pos = PhysicalPosition {
                x: (monitor_size.width as i32 - window_size.width as i32) / 2,
                y: monitor_size.height as i32 - window_size.height as i32 - 40, // 40px buffer from bottom
            };
            window.set_position(new_pos).unwrap();
        }
        window.show().unwrap();
        window.set_focus().unwrap();
        
        // Emit window-shown event
        app.emit("window-shown", ()).unwrap();
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    println!("Quit app command called");
    app.exit(0);
}

#[tauri::command]
fn set_ignore_cursor_events(app: tauri::AppHandle, ignore: bool) {
    if let Some(window) = app.get_webview_window("main") {
        window.set_ignore_cursor_events(ignore).unwrap();
    }
}

#[tauri::command]
fn resize_window(app: tauri::AppHandle, height: f64) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(true) = window.is_visible() {
            if let Ok(Some(monitor)) = window.primary_monitor() {
                let monitor_size = monitor.size();
                let max_height = monitor_size.height as f64 * 0.9; // 90% of screen height
                let new_height = height.min(max_height);

                let current_size = window.outer_size().unwrap();
                window.set_size(tauri::LogicalSize::new(current_size.width as f64 / monitor.scale_factor(), new_height / monitor.scale_factor())).unwrap();

                // Recalculate and set position to keep it at the bottom
                let new_pos = PhysicalPosition {
                    x: (monitor_size.width as i32 - current_size.width as i32) / 2,
                    y: monitor_size.height as i32 - (new_height as i32) - 40, // 40px buffer from bottom
                };
                window.set_position(new_pos).unwrap();
            }
        }
    }
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
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_wake_word_detection,
            stop_wake_word_detection,
            hide_window,
            show_window,
            quit_app,
            resize_window,
            set_ignore_cursor_events,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}
