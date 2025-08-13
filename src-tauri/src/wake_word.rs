// wake_word.rs - Cleaned up version with Web Speech API integration
use crate::audio::AudioCapture;
use anyhow::Result;
use sapi_lite::stt::{Recognizer, Rule, SyncContext};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// Windows Speech Recognition-based wake word detector using sapi_lite
pub struct WakeWordDetector {
    is_listening_for_wake_word: Arc<Mutex<bool>>,
    recognizer: Arc<Mutex<Option<Recognizer>>>,
    audio_capture: Arc<Mutex<Option<AudioCapture>>>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
}

impl WakeWordDetector {
    pub fn new() -> Result<Self> {
        println!("🔧 Initializing SAPI wake word detector...");
        
        // Initialize SAPI
        sapi_lite::initialize().map_err(|e| anyhow::anyhow!("Failed to initialize SAPI: {:?}", e))?;
        
        // Create a recognizer for wake word detection
        let recognizer = Recognizer::new()
            .map_err(|e| anyhow::anyhow!("Failed to create recognizer: {:?}", e))?;
        
        println!("✅ SAPI wake word detector initialized successfully!");
        
        Ok(WakeWordDetector {
            is_listening_for_wake_word: Arc::new(Mutex::new(false)),
            recognizer: Arc::new(Mutex::new(Some(recognizer))),
            audio_capture: Arc::new(Mutex::new(None)),
            app_handle: Arc::new(Mutex::new(None)),
        })
    }
    
    // Set the app handle for emitting events
    pub fn set_app_handle(&self, app_handle: AppHandle) {
        *self.app_handle.lock().unwrap() = Some(app_handle);
    }
    
    pub fn start_listening(&self, callback: impl Fn(usize) + Send + Sync + 'static) {
        let mut is_listening_guard = self.is_listening_for_wake_word.lock().unwrap();
        if *is_listening_guard {
            println!("⚠️ Already listening for wake word, ignoring start request");
            return;
        }
        *is_listening_guard = true;
        drop(is_listening_guard);
        
        let is_listening_for_wake_word = Arc::clone(&self.is_listening_for_wake_word);
        let recognizer = Arc::clone(&self.recognizer);
        let callback = Arc::new(callback);
        
        // Start wake word detection in a separate thread
        thread::spawn(move || {
            println!("🎙️ Started listening for wake words with SAPI...");
            
            // Get the recognizer from the Arc<Mutex>
            let recognizer_guard = recognizer.lock().unwrap();
            let recognizer = match recognizer_guard.as_ref() {
                Some(recognizer) => recognizer,
                None => {
                    eprintln!("❌ Recognizer not available");
                    let mut guard = is_listening_for_wake_word.lock().unwrap();
                    *guard = false;
                    return;
                }
            };
            
            // Create a synchronous context for recognition
            let ctx = match SyncContext::new(recognizer) {
                Ok(ctx) => ctx,
                Err(e) => {
                    eprintln!("❌ Failed to create recognition context: {:?}", e);
                    let mut guard = is_listening_for_wake_word.lock().unwrap();
                    *guard = false;
                    return;
                }
            };
            
            // Create a grammar with the wake word "Hey Jackson"
            let grammar = match ctx
                .grammar_builder()
                .add_rule(&Rule::text("Hey Jackson"))
                .build()
            {
                Ok(grammar) => grammar,
                Err(e) => {
                    eprintln!("❌ Failed to create grammar: {:?}", e);
                    let mut guard = is_listening_for_wake_word.lock().unwrap();
                    *guard = false;
                    return;
                }
            };
            
            // Enable the grammar
            if let Err(e) = grammar.set_enabled(true) {
                eprintln!("❌ Failed to enable grammar: {:?}", e);
                let mut guard = is_listening_for_wake_word.lock().unwrap();
                *guard = false;
                return;
            }
            
            println!("✅ SAPI recognition started successfully");
            
            // Keep recognizing while listening
            while {
                let guard = is_listening_for_wake_word.lock().unwrap();
                *guard
            } {
                // Try to recognize the wake word with a timeout
                match ctx.recognize(Duration::from_millis(500)) {
                    Ok(Some(phrase)) => {
                        let text = phrase.text.to_string_lossy();
                        println!("🔊 Recognized: {}", text);
                        
                        // Check if "Hey Jackson" was recognized
                        if text.to_lowercase().contains("hey jackson") {
                            println!("🎯 Wake word detected!");
                            callback(0); // Index 0 for "Hey Jackson"
                        }
                    }
                    Ok(None) => {
                        // No recognition, continue listening
                    }
                    Err(e) => {
                        eprintln!("⚠️ Recognition error: {:?}", e);
                        // Continue listening despite errors
                    }
                }
            }
            
            println!("🛑 SAPI wake word recognition stopped.");
        });
    }
    
    pub fn stop_listening(&self) {
        // Stop wake word detection
        let mut guard = self.is_listening_for_wake_word.lock().unwrap();
        *guard = false;
        drop(guard);
        
        // Also stop the audio capture if it exists
        if let Ok(mut capture_guard) = self.audio_capture.lock() {
            if let Some(ref mut capture) = capture_guard.as_mut() {
                capture.stop_capture();
            }
            *capture_guard = None;
        }
        
        println!("🛑 Stopped listening.");
    }
}

// Make WakeWordDetector thread-safe
unsafe impl Send for WakeWordDetector {}
unsafe impl Sync for WakeWordDetector {}

// Finalize SAPI when the program exits
impl Drop for WakeWordDetector {
    fn drop(&mut self) {
        println!("🔧 Finalizing SAPI...");
        sapi_lite::finalize();
        println!("✅ SAPI finalized successfully");
    }
}