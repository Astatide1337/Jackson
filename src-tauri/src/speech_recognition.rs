// speech_recognition.rs - Minimal placeholder since we're using Web Speech API
use anyhow::Result;

pub struct SpeechRecognizer {
    // Empty struct - all speech recognition is handled by Web Speech API in frontend
}

impl SpeechRecognizer {
    pub fn new() -> Result<Self> {
        println!("🔧 Speech recognition delegated to Web Speech API in frontend");
        Ok(SpeechRecognizer {})
    }
    
    pub fn start_listening(&self, _callback: impl Fn(String) + Send + Sync + 'static) -> Result<()> {
        println!("⚠️ Speech recognition start_listening called - should use Web Speech API instead");
        Ok(())
    }
    
    pub fn stop_listening(&self) {
        println!("⚠️ Speech recognition stop_listening called - should use Web Speech API instead");
    }
}

// Make SpeechRecognizer thread-safe
unsafe impl Send for SpeechRecognizer {}
unsafe impl Sync for SpeechRecognizer {}