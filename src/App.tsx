// App.tsx - Fixed with smooth transitions and proper timeout handling
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./index.css";

// Speech Recognition interfaces
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
  const [fullTranscript, setFullTranscript] = useState("");
  const [isWindowVisible, setIsWindowVisible] = useState(false);
  const [lastSpeechTime, setLastSpeechTime] = useState<Date>(new Date());

  const speechTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const isRecognitionActiveRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasDetectedSpeechRef = useRef(false);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isFirstResizeRef = useRef(true);

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

          // Show window only when we have actual speech
          if (!isWindowVisible) {
            setIsWindowVisible(true);
          }
        }

        // Handle final results
        if (finalTranscript) {
          const cleanTranscript = finalTranscript.trim();
          setFullTranscript((prev) => prev + cleanTranscript + " ");
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
        setFullTranscript("");
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

  const hideWindow = () => {
    stopSpeechRecognition();
    setUserSpeech("");
    setFullTranscript("");
    setIsProcessing(false);
    setIsWindowVisible(false);
    hasDetectedSpeechRef.current = false;

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
        console.log("✅ Window shown");
      }).then((unlisten) => {
        unlistenShow = unlisten;
      });

      // Listen for window hide event
      listen("window-hidden", () => {
        setIsWindowVisible(false);
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
    if (!isTauriContext || !containerRef.current || !isWindowVisible) {
      isFirstResizeRef.current = true; // Reset on hide
      return;
    }
    const container = containerRef.current;
    const resizeObserver = new ResizeObserver((entries) => {
      if (isFirstResizeRef.current) {
        isFirstResizeRef.current = false;
        return; // Skip the very first resize observation
      }
      for (let entry of entries) {
        const { scrollWidth, scrollHeight } = entry.target;

        // Calculate new dimensions with padding but ensure they don't exceed max
        // Base width on content length with some flexibility
        let newWidth = Math.min(Math.max(scrollWidth + 60, 400), 800); // Add padding, min 400px, max 800px

        // For longer text, increase width more
        if (fullTranscript.length > 100) {
          newWidth = Math.min(newWidth + 50, 800);
        }

        const newHeight = Math.min(Math.max(scrollHeight + 60, 350), 600); // Add padding, min 350px, max 600px

        // Invoke the resize command with both width and height
        invoke("resize_window", { width: newWidth, height: newHeight });
      }
    });
    // Delay observation slightly to let the window stabilize
    const timer = setTimeout(() => {
      resizeObserver.observe(container);
    }, 100);

    return () => {
      clearTimeout(timer);
      resizeObserver.unobserve(container);
    };
  }, [isTauriContext, isWindowVisible, fullTranscript, userSpeech]);
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
          setFullTranscript("");
          setLastSpeechTime(new Date());

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
      stopSpeechRecognition();
    };
  }, []);

  return (
    <>
      {/* Only render the UI when actively listening to speech */}
      {isWindowVisible && isSpeechListening && (
        // App.tsx - Add this to the container div for smoother content transitions
        <div
          ref={containerRef}
          className={`min-h-screen flex items-end justify-center p-4 bg-gradient-to-br from-transparent to-transparent transition-all duration-300 ease-out preserve-content`}
          onMouseEnter={() =>
            invoke("set_ignore_cursor_events", { ignore: false })
          }
          onMouseLeave={() =>
            invoke("set_ignore_cursor_events", { ignore: true })
          }
        >
          <div className="w-full resize-smooth window-resize content-container">
            <div className="backdrop-blur-2xl bg-white/10 dark:bg-black/30 rounded-2xl border border-white/20 shadow-2xl overflow-hidden resize-transition">
              <div className="p-6 resize-transition">
                <div className="flex flex-col items-center justify-center space-y-4">
                  {/* Animated listening indicator */}
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center bg-green-500/20 animate-pulse">
                      <div className="w-8 h-8 rounded-full bg-green-500 animate-ping"></div>
                    </div>

                    {/* Outer ring animation */}
                    <div className="absolute inset-0 rounded-full border-2 animate-ping border-green-400/30"></div>
                  </div>

                  {/* Status and content */}
                  <div className="text-center space-y-2">
                    <h1 className="text-2xl font-bold text-white drop-shadow-lg">
                      Jackson Assistant
                    </h1>
                    <p className="text-white/90 text-base font-medium">
                      {statusMessage}
                    </p>

                    {/* Current speech display with smooth transitions */}
                    {userSpeech && (
                      <div className="mt-3 p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 backdrop-blur-sm">
                        <p className="text-blue-200 text-base">
                          {isProcessing ? "🎙️ " : "✅ "}
                          {userSpeech}
                        </p>
                        {isProcessing && (
                          <div className="flex items-center justify-center mt-2 space-x-1">
                            <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                            <div
                              className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                              style={{ animationDelay: "0.2s" }}
                            ></div>
                            <div
                              className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                              style={{ animationDelay: "0.4s" }}
                            ></div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Full transcript display with smooth horizontal and vertical expansion */}
                    {fullTranscript && (
                      <div className="mt-3 p-4 bg-gray-500/10 rounded-xl border border-gray-500/20 backdrop-blur-sm max-h-48 overflow-y-auto resize-transition text-wrap">
                        <p className="text-xs text-gray-300 mb-2">
                          Full Transcript:
                        </p>
                        <p className="text-gray-200 text-sm break-words leading-relaxed text-wrap">
                          {fullTranscript.trim()}
                        </p>
                      </div>
                    )}

                    <div className="flex items-center justify-center space-x-4 text-xs">
                      <p className="text-blue-300">
                        Detections: {detectionCount}
                      </p>
                      <div className="flex items-center space-x-1">
                        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                        <span className="text-green-300">Speech Active</span>
                      </div>
                    </div>

                    <div className="mt-3 p-3 bg-green-500/10 rounded-xl border border-green-500/20 backdrop-blur-sm">
                      <p className="text-green-300 font-bold text-lg">
                        I'm listening! 🎙️
                      </p>
                      <p className="text-green-400 text-base">
                        Speak now - I'll hear everything you say
                      </p>
                    </div>
                  </div>
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
