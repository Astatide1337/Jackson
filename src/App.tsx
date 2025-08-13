// Add this to your App.tsx - Web Speech API integration
import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './index.css';

// Add these interfaces at the top of your file
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: {
      new (): SpeechRecognition;
    };
    webkitSpeechRecognition: {
      new (): SpeechRecognition;
    };
  }
}

function App() {
  const [isListening, setIsListening] = useState(false);
  const [wakeWordDetected, setWakeWordDetected] = useState(false);
  const [detectedKeyword, setDetectedKeyword] = useState('');
  const [statusMessage, setStatusMessage] = useState('Initializing...');
  const [initializationError, setInitializationError] = useState(false);
  const [isTauriContext, setIsTauriContext] = useState(false);
  const [detectionCount, setDetectionCount] = useState(0);
  const [userSpeech, setUserSpeech] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastActivity, setLastActivity] = useState<Date>(new Date());
  const [isSpeechListening, setIsSpeechListening] = useState(false);
  const [fullTranscript, setFullTranscript] = useState('');
  
  const inactivityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const isRecognitionActiveRef = useRef(false);

  // Initialize Web Speech API
  const initializeSpeechRecognition = () => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;
      
      recognition.onstart = () => {
        console.log('🎙️ Web Speech Recognition started');
        setIsSpeechListening(true);
        isRecognitionActiveRef.current = true;
      };
      
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = '';
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }
        
        // Update the display with interim results
        if (interimTranscript) {
          setUserSpeech(interimTranscript);
          setIsProcessing(true);
        }
        
        // Handle final results
        if (finalTranscript) {
          const cleanTranscript = finalTranscript.trim();
          setFullTranscript(prev => prev + cleanTranscript + ' ');
          setUserSpeech(cleanTranscript);
          setIsProcessing(false);
          
          console.log('🗣️ Final speech:', cleanTranscript);
          
          // Check for stop commands
          if (cleanTranscript.toLowerCase().includes('stop listening') ||
              cleanTranscript.toLowerCase().includes('goodbye') ||
              cleanTranscript.toLowerCase().includes('bye jackson')) {
            stopSpeechRecognition();
          }
          
          resetInactivityTimer();
        }
      };
      
      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error);
        
        if (event.error === 'no-speech') {
          // No speech detected, continue listening
          return;
        }
        
        if (event.error === 'not-allowed') {
          setStatusMessage('Microphone access denied. Please allow microphone access.');
          setInitializationError(true);
        } else {
          console.warn('Speech recognition error:', event.error);
          // Try to restart recognition after a brief delay
          if (isRecognitionActiveRef.current) {
            setTimeout(() => {
              if (isRecognitionActiveRef.current) {
                try {
                  recognition.start();
                } catch (e) {
                  console.error('Failed to restart recognition:', e);
                }
              }
            }, 1000);
          }
        }
      };
      
      recognition.onend = () => {
        console.log('🛑 Web Speech Recognition ended');
        setIsSpeechListening(false);
        
        // Restart recognition if we're supposed to be listening
        if (isRecognitionActiveRef.current && wakeWordDetected) {
          try {
            recognition.start();
          } catch (e) {
            console.error('Failed to restart recognition:', e);
            isRecognitionActiveRef.current = false;
          }
        }
      };
      
      speechRecognitionRef.current = recognition;
      return true;
    }
    return false;
  };

  const startSpeechRecognition = () => {
    if (speechRecognitionRef.current && !isSpeechListening) {
      try {
        isRecognitionActiveRef.current = true;
        speechRecognitionRef.current.start();
        setFullTranscript('');
        setUserSpeech('');
        setIsProcessing(false);
        console.log('🎙️ Starting continuous speech recognition...');
      } catch (error) {
        console.error('Failed to start speech recognition:', error);
        setStatusMessage('Failed to start speech recognition');
      }
    }
  };

  const stopSpeechRecognition = () => {
    if (speechRecognitionRef.current && isSpeechListening) {
      isRecognitionActiveRef.current = false;
      speechRecognitionRef.current.stop();
      setIsSpeechListening(false);
      setIsProcessing(false);
      console.log('🛑 Stopping continuous speech recognition...');
    }
  };

  // Reset inactivity timer
  const resetInactivityTimer = () => {
    setLastActivity(new Date());
    
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
    }
    
    inactivityTimeoutRef.current = setTimeout(() => {
      if (isTauriContext) {
        stopSpeechRecognition();
        invoke('hide_window');
        setWakeWordDetected(false);
        setUserSpeech('');
        setFullTranscript('');
      }
    }, 30000); // 30 seconds of inactivity
  };

  useEffect(() => {
    // Check if we're in a Tauri context
    const checkTauriContext = () => {
      const isTauri = typeof window !== 'undefined' && 
                     (window as any).__TAURI_INTERNALS__;
      setIsTauriContext(isTauri);
      return isTauri;
    };

    // Initialize speech recognition
    const speechSupported = initializeSpeechRecognition();
    if (!speechSupported) {
      console.warn('Web Speech API not supported in this browser');
      setStatusMessage('Speech recognition not supported in this browser');
    }

    // This effect handles the lifecycle of the Tauri event listener.
    let unlisten: (() => void) | undefined;
    
    const initialize = async () => {
      // Check if we are in a Tauri environment.
      if (!checkTauriContext()) {
        console.warn('Tauri API not available, running in web mode');
        setStatusMessage('Web mode - limited functionality');
        return;
      }
      
      try {
        // Set up the event listener for wake word detection.
        unlisten = await listen('wake-word-detected', (event) => {
          const payload = event.payload as { keyword_index: number };
          const keyword_index = payload.keyword_index;
          
          const keywords = ["Hey Jackson"];
          const keyword = keywords[keyword_index] || "Unknown";
          
          setDetectedKeyword(keyword);
          setWakeWordDetected(true);
          setIsListening(false);
          setDetectionCount(prev => prev + 1);
          setStatusMessage(`Listening for speech...`);
          setUserSpeech('');
          setFullTranscript('');
          resetInactivityTimer();
          
          // Start Web Speech API recognition
          if (speechSupported) {
            setTimeout(() => {
              startSpeechRecognition();
            }, 500); // Small delay to ensure UI updates
          }
        });
        
        // Start the backend wake word detection
        await invoke('start_wake_word_detection');
        setIsListening(true);
        setStatusMessage('Listening for "Hey Jackson"...');
        setInitializationError(false);
      } catch (error) {
        console.error('Failed to initialize wake word detection:', error);
        setStatusMessage('Wake word detection unavailable. Speech recognition still works.');
        setInitializationError(true);
      }
    };
    
    // Add a small delay to ensure Tauri API is ready
    const timer = setTimeout(() => {
      initialize();
    }, 100);
    
    // Cleanup function
    return () => {
      clearTimeout(timer);
      unlisten?.();
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }
      stopSpeechRecognition();
    };
  }, []);

  // Handle manual test
  const handleManualTest = async () => {
    if (!isTauriContext) return;
    
    try {
      setDetectedKeyword("Hey Jackson");
      setWakeWordDetected(true);
      setIsListening(false);
      setDetectionCount(prev => prev + 1);
      setStatusMessage('Listening for speech...');
      setUserSpeech('');
      setFullTranscript('');
      resetInactivityTimer();
      
      // Start speech recognition
      startSpeechRecognition();
    } catch (error) {
      console.error('Manual test failed:', error);
    }
  };

  // Handle manual speech start (for testing without wake word)
  const handleManualSpeechStart = () => {
    if (!wakeWordDetected) {
      setWakeWordDetected(true);
      setStatusMessage('Listening for speech...');
    }
    startSpeechRecognition();
    resetInactivityTimer();
  };

  const handleManualSpeechStop = () => {
    stopSpeechRecognition();
  };

  // Update activity on user interaction
  const handleUserInteraction = () => {
    resetInactivityTimer();
  };

  return (
    <div 
      className="min-h-screen flex items-end justify-center p-4 bg-gradient-to-br from-transparent to-transparent"
      onClick={(e) => {
        e.stopPropagation();
        handleUserInteraction();
      }}
      onMouseMove={handleUserInteraction}
    >
      <div className="w-full max-w-lg mb-8">
        <div className="backdrop-blur-2xl bg-white/10 dark:bg-black/30 rounded-2xl border border-white/20 shadow-2xl overflow-hidden">
          <div className="p-6">
            <div className="flex flex-col items-center justify-center space-y-4">
              {/* Animated listening indicator */}
              <div className="relative">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500 ${
                  isSpeechListening 
                    ? 'bg-green-500/20 animate-pulse' 
                    : isListening 
                      ? 'bg-blue-500/20 animate-pulse' 
                      : wakeWordDetected 
                        ? 'bg-yellow-500/20' 
                        : initializationError
                          ? 'bg-red-500/20'
                          : 'bg-gray-500/20'
                }`}>
                  <div className={`w-8 h-8 rounded-full transition-all duration-500 ${
                    isSpeechListening 
                      ? 'bg-green-500 animate-ping' 
                      : isListening 
                        ? 'bg-blue-500 animate-ping' 
                        : wakeWordDetected 
                          ? 'bg-yellow-500' 
                          : initializationError
                            ? 'bg-red-500'
                            : 'bg-gray-500'
                  }`}></div>
                </div>
                
                {/* Outer ring animation */}
                {(isListening || isSpeechListening) && (
                  <div className={`absolute inset-0 rounded-full border-2 animate-ping ${
                    isSpeechListening ? 'border-green-400/30' : 'border-blue-400/30'
                  }`}></div>
                )}
              </div>
              
              {/* Status and content */}
              <div className="text-center space-y-2">
                <h1 className="text-2xl font-bold text-white drop-shadow-lg">
                  Jackson Assistant
                </h1>
                <p className="text-white/90 text-base font-medium">
                  {statusMessage}
                </p>
                
                {/* Current speech display */}
                {userSpeech && (
                  <div className="mt-3 p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 backdrop-blur-sm">
                    <p className="text-blue-200 text-base">
                      {isProcessing ? '🎙️ ' : '✅ '}{userSpeech}
                    </p>
                    {isProcessing && (
                      <div className="flex items-center justify-center mt-2 space-x-1">
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                      </div>
                    )}
                  </div>
                )}

                {/* Full transcript display */}
                {fullTranscript && (
                  <div className="mt-3 p-3 bg-gray-500/10 rounded-xl border border-gray-500/20 backdrop-blur-sm max-h-32 overflow-y-auto">
                    <p className="text-xs text-gray-300 mb-1">Full Transcript:</p>
                    <p className="text-gray-200 text-sm">
                      {fullTranscript}
                    </p>
                  </div>
                )}
                
                <div className="flex items-center justify-center space-x-4 text-xs">
                  <p className="text-blue-300">
                    Detections: {detectionCount}
                  </p>
                  {isListening && (
                    <div className="flex items-center space-x-1">
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                      <span className="text-blue-300">Wake Word</span>
                    </div>
                  )}
                  {isSpeechListening && (
                    <div className="flex items-center space-x-1">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                      <span className="text-green-300">Speech</span>
                    </div>
                  )}
                </div>
                
                {detectedKeyword && (
                  <div className="mt-3 p-3 bg-green-500/10 rounded-xl border border-green-500/20 backdrop-blur-sm">
                    <p className="text-green-300 font-bold text-lg">
                      "{detectedKeyword}" detected!
                    </p>
                    <p className="text-green-400 text-base">
                      Speak now - I'm listening to everything you say 🎙️
                    </p>
                  </div>
                )}
              </div>
              
              {/* Control buttons */}
              <div className="flex gap-2 flex-wrap justify-center">
                {isTauriContext && !wakeWordDetected && (
                  <button
                    onClick={handleManualTest}
                    className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 rounded-lg text-purple-200 text-sm font-medium transition-all duration-200 hover:scale-105 backdrop-blur-sm"
                  >
                    Test Wake Word
                  </button>
                )}
                
                {/* Manual speech controls for testing */}
                {!isSpeechListening ? (
                  <button
                    onClick={handleManualSpeechStart}
                    className="px-4 py-2 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 rounded-lg text-green-200 text-sm font-medium transition-all duration-200 hover:scale-105 backdrop-blur-sm"
                  >
                    Start Speaking
                  </button>
                ) : (
                  <button
                    onClick={handleManualSpeechStop}
                    className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-red-200 text-sm font-medium transition-all duration-200 hover:scale-105 backdrop-blur-sm"
                  >
                    Stop Speaking
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;