// App.tsx - Fixed window resizing with content-based triggers
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./index.css";

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
  const [statusMessage, setStatusMessage] = useState(
    'Listening for "Hey Jackson"...'
  );
  const [initializationError, setInitializationError] = useState(false);
  const [isTauriContext, setIsTauriContext] = useState(false);
  const [detectionCount, setDetectionCount] = useState(0);
  const [userSpeech, setUserSpeech] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeechListening, setIsSpeechListening] = useState(false);
  const [isWindowVisible, setIsWindowVisible] = useState(false);
  const [lastSpeechTime, setLastSpeechTime] = useState<Date>(new Date());
  const [wakeWordDetected, setWakeWordDetected] = useState(false);
  
  const speechTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const isRecognitionActiveRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasDetectedSpeechRef = useRef(false);
  
  // New resize management refs
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isResizingRef = useRef(false);
  const lastResizeContentRef = useRef({ userSpeech: "", isProcessing: false });
  const pendingResizeRef = useRef(false);
  
  // Initialize Web Speech API
  const initializeSpeechRecognition = () => {
    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.maxAlternatives = 1;
      
      recognition.onstart = () => {
        console.log("🎙️ Web Speech Recognition started");
        setIsSpeechListening(true);
        isRecognitionActiveRef.current = true;
        hasDetectedSpeechRef.current = false;
      };
      
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = "";
        let finalTranscript = "";
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + " ";
          } else {
            interimTranscript += transcript;
          }
        }
        
        // Update the display with interim results
        if (interimTranscript) {
          setUserSpeech(interimTranscript);
          setIsProcessing(true);
          setLastSpeechTime(new Date());
          hasDetectedSpeechRef.current = true;
          resetSpeechTimeout();
        }
        
        // Handle final results
        if (finalTranscript) {
          const cleanTranscript = finalTranscript.trim();
          setUserSpeech(cleanTranscript);
          setIsProcessing(false);
          setLastSpeechTime(new Date());
          hasDetectedSpeechRef.current = true;
          console.log("🗣️ Final speech:", cleanTranscript);
          
          // Check for stop commands
          if (
            cleanTranscript.toLowerCase().includes("stop listening") ||
            cleanTranscript.toLowerCase().includes("goodbye") ||
            cleanTranscript.toLowerCase().includes("bye jackson")
          ) {
            hideWindow();
            return;
          }
          
          resetSpeechTimeout();
        }
      };
      
      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === "no-speech") {
          // No speech detected, continue listening
          return;
        }
        if (event.error === "not-allowed") {
          setStatusMessage(
            "Microphone access denied. Please allow microphone access."
          );
          setInitializationError(true);
        } else {
          console.warn("Speech recognition error:", event.error);
          // Try to restart recognition after a brief delay
          if (isRecognitionActiveRef.current) {
            setTimeout(() => {
              if (isRecognitionActiveRef.current) {
                try {
                  recognition.start();
                } catch (e) {
                  console.error("Failed to restart recognition:", e);
                }
              }
            }, 1000);
          }
        }
      };
      
      recognition.onend = () => {
        console.log("🛑 Web Speech Recognition ended");
        setIsSpeechListening(false);
        // Restart recognition if we're supposed to be listening
        if (isRecognitionActiveRef.current && isWindowVisible) {
          try {
            recognition.start();
          } catch (e) {
            console.error("Failed to restart recognition:", e);
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
        setUserSpeech("");
        setIsProcessing(false);
        setLastSpeechTime(new Date());
        hasDetectedSpeechRef.current = false;
        resetSpeechTimeout();
        console.log("🎙️ Starting continuous speech recognition...");
      } catch (error) {
        console.error("Failed to start speech recognition:", error);
        setStatusMessage("Failed to start speech recognition");
      }
    }
  };
  
  const stopSpeechRecognition = () => {
    if (speechRecognitionRef.current && isSpeechListening) {
      isRecognitionActiveRef.current = false;
      speechRecognitionRef.current.stop();
      setIsSpeechListening(false);
      setIsProcessing(false);
      console.log("🛑 Stopping continuous speech recognition...");
    }
    
    // Clear speech timeout
    if (speechTimeoutRef.current) {
      clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
  };
  
  // Reset speech timeout - if no transcribed speech for 10 seconds, hide window
  const resetSpeechTimeout = () => {
    if (speechTimeoutRef.current) {
      clearTimeout(speechTimeoutRef.current);
    }
    
    speechTimeoutRef.current = setTimeout(() => {
      console.log("🕐 No speech transcription for 10 seconds, hiding window");
      hideWindow();
    }, 10000); // 10 seconds of no transcribed speech
  };
  
  // Calculate window size based on content - optimized for minimal design
  const calculateWindowSize = () => {
    if (!containerRef.current) return { width: 520, height: 220 };
    
    // Create a temporary clone to measure actual content size
    const container = containerRef.current;
    const clone = container.cloneNode(true) as HTMLElement;
    
    // Set up the clone for measurement
    clone.style.position = "absolute";
    clone.style.visibility = "hidden";
    clone.style.height = "auto";
    clone.style.width = "100%"; // Use the same width constraints
    clone.style.maxWidth = "42rem"; // max-w-2xl
    clone.style.overflow = "visible";
    
    document.body.appendChild(clone);
    
    // Measure the clone
    const contentWidth = clone.scrollWidth;
    const contentHeight = clone.scrollHeight;
    
    document.body.removeChild(clone);
    
    // Add padding to the content size to get the final window size.
    // p-6 on root = 1.5rem * 2 = 3rem = 48px
    const finalWidth = Math.min(contentWidth + 48, 800);
    const finalHeight = Math.min(contentHeight + 48, 600);

    return { width: finalWidth, height: finalHeight };
  };
  
  // Check if content change is significant enough to warrant a resize
  const isSignificantContentChange = (newUserSpeech: string, newIsProcessing: boolean) => {
    const lastContent = lastResizeContentRef.current;
    
    // Check for significant text length changes (more than 25 characters or 40% change)
    const speechLengthDiff = Math.abs(newUserSpeech.length - lastContent.userSpeech.length);
    const speechPercentChange = lastContent.userSpeech.length > 0 ? speechLengthDiff / lastContent.userSpeech.length : 1;
    
    // Processing state change is always significant
    if (newIsProcessing !== lastContent.isProcessing) {
      return true;
    }
    
    // First content appearance is always significant
    if ((lastContent.userSpeech === "" && newUserSpeech !== "")) {
      return true;
    }
    
    // Significant if text length changed by more than 25 chars or 40%
    return speechLengthDiff > 25 || speechPercentChange > 0.4;
  };
  
  // Trigger window resize with content-based logic
  const triggerWindowResize = (newUserSpeech: string, newIsProcessing: boolean) => {
    // Skip if we're already resizing or window is not visible
    if (!isTauriContext || !isWindowVisible || isResizingRef.current) {
      return;
    }
    
    // Check if this is a significant content change
    if (!isSignificantContentChange(newUserSpeech, newIsProcessing)) {
      return;
    }
    
    console.log("🔄 Content change detected, scheduling resize");
    
    // Mark that we have a pending resize
    pendingResizeRef.current = true;
    
    // Clear any existing timeout
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }
    
    // Debounce the resize operation
    resizeTimeoutRef.current = setTimeout(() => {
      if (!pendingResizeRef.current || !containerRef.current || !isWindowVisible) {
        return;
      }
      
      // Mark as resizing to prevent loops
      isResizingRef.current = true;
      pendingResizeRef.current = false;
      
      // Calculate new size
      const newSize = calculateWindowSize();
      
      console.log(`📏 Resizing window to: ${newSize.width}x${newSize.height}`);
      
      // Update last resize content reference
      lastResizeContentRef.current = {
        userSpeech: newUserSpeech,
        isProcessing: newIsProcessing
      };
      
      // Call the combined resize and position function with smooth transition
      invoke("resize_and_position_window", { 
        width: newSize.width, 
        height: newSize.height 
      }).then(() => {
        console.log("✅ Window resized successfully");
        // Allow future resizes after a longer delay to prevent jerky animations
        setTimeout(() => {
          isResizingRef.current = false;
        }, 400);
      }).catch(e => {
        console.error("❌ Failed to resize window:", e);
        isResizingRef.current = false;
      });
    }, 400); // Longer debounce for much smoother experience
  };
  
  // Content change monitoring effects
  useEffect(() => {
    triggerWindowResize(userSpeech, isProcessing);
  }, [userSpeech, isProcessing, isWindowVisible]);
  
  const hideWindow = () => {
    stopSpeechRecognition();
    setUserSpeech("");
    setIsProcessing(false);
    setIsWindowVisible(false);
    setWakeWordDetected(false);
    hasDetectedSpeechRef.current = false;
    
    // Reset resize state
    isResizingRef.current = false;
    pendingResizeRef.current = false;
    lastResizeContentRef.current = { userSpeech: "", isProcessing: false };
    
    if (isTauriContext) {
      invoke("hide_window");
    }
    
    // Clear timeouts
    if (speechTimeoutRef.current) {
      clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = null;
    }
  };
  
  // Handle window visibility events
  useEffect(() => {
    let unlistenShow: (() => void) | undefined;
    let unlistenHide: (() => void) | undefined;
    
    if (isTauriContext) {
      // Listen for window show event
      listen("window-shown", () => {
        setIsWindowVisible(true);
        // Reset resize state when window is shown
        isResizingRef.current = false;
        pendingResizeRef.current = false;
        console.log("✅ Window shown");
      }).then((unlisten) => {
        unlistenShow = unlisten;
      });
      
      // Listen for window hide event
      listen("window-hidden", () => {
        setIsWindowVisible(false);
        // Reset resize state when window is hidden
        isResizingRef.current = false;
        pendingResizeRef.current = false;
        console.log("🙈 Window hidden");
      }).then((unlisten) => {
        unlistenHide = unlisten;
      });
    }
    
    return () => {
      unlistenShow?.();
      unlistenHide?.();
    };
  }, [isTauriContext]);
  
  useEffect(() => {
    // Check if we're in a Tauri context
    const checkTauriContext = () => {
      const isTauri =
        typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__;
      setIsTauriContext(isTauri);
      return isTauri;
    };
    
    // Initialize speech recognition
    const speechSupported = initializeSpeechRecognition();
    if (!speechSupported) {
      console.warn("Web Speech API not supported in this browser");
      setStatusMessage("Speech recognition not supported in this browser");
    }
    
    // This effect handles the lifecycle of the Tauri event listener.
    let unlisten: (() => void) | undefined;
    
    const initialize = async () => {
      // Check if we are in a Tauri environment.
      if (!checkTauriContext()) {
        console.warn("Tauri API not available, running in web mode");
        setStatusMessage("Web mode - limited functionality");
        return;
      }
      
      try {
        // Set up the event listener for wake word detection.
        unlisten = await listen("wake-word-detected", (event) => {
          const payload = event.payload as { keyword_index: number };
          const keyword_index = payload.keyword_index;
          const keywords = ["Hey Jackson"];
          const keyword = keywords[keyword_index] || "Unknown";
          
          setDetectionCount((prev) => prev + 1);
          setStatusMessage(`Listening for speech...`);
          setUserSpeech("");
          setLastSpeechTime(new Date());
          setWakeWordDetected(true);
          setIsWindowVisible(true);
          
          // Reset resize state on wake word detection
          isResizingRef.current = false;
          pendingResizeRef.current = false;
          lastResizeContentRef.current = { userSpeech: "", isProcessing: false };
          
          console.log(`🎯 Wake word "${keyword}" detected!`);
          
          // Start Web Speech API recognition and timeout
          if (speechSupported) {
            setTimeout(() => {
              startSpeechRecognition();
              resetSpeechTimeout();
            }, 500); // Small delay to ensure UI updates
          }
        });
        
        // Start the backend wake word detection
        await invoke("start_wake_word_detection");
        setStatusMessage('Listening for "Hey Jackson"...');
        setInitializationError(false);
        console.log(
          '✅ Wake word detection started - app is invisible until "Hey Jackson" is detected'
        );
      } catch (error) {
        console.error("Failed to initialize wake word detection:", error);
        setStatusMessage(
          "Wake word detection unavailable. Speech recognition still works."
        );
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
      if (speechTimeoutRef.current) {
        clearTimeout(speechTimeoutRef.current);
      }
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      stopSpeechRecognition();
    };
  }, []);
  
  // Only render the UI when wake word is detected and speech is active
  return (
    <>
      {isWindowVisible && wakeWordDetected && isSpeechListening && (
        <div
          className={`h-screen flex items-center justify-center p-6 bg-gradient-to-br from-transparent to-transparent window-fade-in`}
          onMouseEnter={() =>
            invoke("set_ignore_cursor_events", { ignore: false })
          }
          onMouseLeave={() =>
            invoke("set_ignore_cursor_events", { ignore: true })
          }
        >
          <div ref={containerRef} className="w-full max-w-2xl">
            {/* Main glassmorphism container */}
            <div className="relative backdrop-blur-3xl bg-white/5 dark:bg-black/10 rounded-3xl border border-white/10 shadow-2xl overflow-visible no-select">
              
              {/* Subtle gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent rounded-3xl pointer-events-none"></div>
              
              <div className="relative p-8">
                <div className="flex flex-col items-center space-y-6">
                  
                  {/* Minimalist microphone icon with subtle animation */}
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center backdrop-blur-sm border border-white/10">
                      {/* Microphone SVG */}
                      <svg 
                        width="32" 
                        height="32" 
                        viewBox="0 0 24 24" 
                        fill="none" 
                        className="text-white/90"
                      >
                        <rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="2" />
                        <path d="M19 10v1a7 7 0 0 1-14 0v-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <line x1="8" y1="22" x2="16" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </div>
                    
                    {/* Subtle pulsing ring for active state */}
                    {isSpeechListening && (
                      <div className="absolute inset-0 rounded-full border-2 border-blue-400/30 animate-ping"></div>
                    )}
                  </div>
                  
                  {/* Clean status text */}
                  <div className="text-center">
                    <p className="text-white/80 text-xl font-medium">
                      {isProcessing ? "Processing..." : "Listening"}
                    </p>
                  </div>
                  
                  {/* Current speech - clean bubble design */}
                  {userSpeech && (
                    <p className="text-white/90 text-2xl text-center font-medium leading-relaxed transition-smooth content-fade-in">
                      {userSpeech}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* The window is hidden, so render nothing */}
    </>
  );
}

export default App;