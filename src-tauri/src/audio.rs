use anyhow::Result;
use cpal::traits::DeviceTrait;
use cpal::traits::HostTrait;
use cpal::traits::StreamTrait;
use cpal::{Device, Sample, SampleFormat, Stream, StreamConfig};
use crossbeam_channel::{unbounded, Receiver, Sender};
use std::sync::{Arc, Mutex};

pub struct AudioCapture {
    is_capturing: Arc<Mutex<bool>>,
    shutdown_sender: Option<Sender<()>>,
    _stream: Option<Stream>, // Keep the stream alive
}

impl AudioCapture {
    pub fn new() -> Self {
        Self {
            is_capturing: Arc::new(Mutex::new(false)),
            shutdown_sender: None,
            _stream: None,
        }
    }

    // Updated to match the wake_word.rs usage with single parameter
    pub fn start_capture<F>(&mut self, callback: F) -> Result<()>
    where
        F: Fn(Vec<i16>) + Send + 'static,
    {
        let mut is_capturing_guard = self.is_capturing.lock().unwrap();
        if *is_capturing_guard {
            return Ok(());
        }
        *is_capturing_guard = true;
        drop(is_capturing_guard);

        let is_capturing = Arc::clone(&self.is_capturing);
        let (shutdown_sender, shutdown_receiver) = unbounded();
        self.shutdown_sender = Some(shutdown_sender);

        // Start audio capture in the current thread (don't spawn another thread)
        let stream = Self::capture_audio_stream(callback, is_capturing, shutdown_receiver)?;
        
        // Store the stream to keep it alive
        self._stream = Some(stream);
        
        println!("🎙️ Audio capture started");
        Ok(())
    }

    // Alternative method if you need both audio_frame and sample_rate
    #[allow(dead_code)]
    pub fn start_capture_with_sample_rate<F>(&mut self, callback: F) -> Result<()>
    where
        F: Fn(Vec<i16>, u32) + Send + 'static,
    {
        let mut is_capturing_guard = self.is_capturing.lock().unwrap();
        if *is_capturing_guard {
            return Ok(());
        }
        *is_capturing_guard = true;
        drop(is_capturing_guard);

        let is_capturing = Arc::clone(&self.is_capturing);
        let (shutdown_sender, shutdown_receiver) = unbounded();
        self.shutdown_sender = Some(shutdown_sender);

        // Start audio capture in the current thread (don't spawn another thread)
        let stream = Self::capture_audio_stream_with_sample_rate(callback, is_capturing, shutdown_receiver)?;
        
        // Store the stream to keep it alive
        self._stream = Some(stream);
        
        println!("🎙️ Audio capture with sample rate started");
        Ok(())
    }

    fn capture_audio_stream<F>(
        callback: F,
        is_capturing: Arc<Mutex<bool>>,
        _shutdown_receiver: Receiver<()>,
    ) -> Result<Stream>
    where
        F: Fn(Vec<i16>) + Send + 'static,
    {
        // Get the default audio input device
        let device = cpal::default_host()
            .default_input_device()
            .ok_or_else(|| anyhow::anyhow!("No default input device available"))?;
        
        println!(
            "🎤 Using audio device: {}",
            device.name().unwrap_or_else(|_| "Unknown".to_string())
        );

        // Get the default config for the device
        let config = device.default_input_config()?;
        println!("📊 Default audio config: {:?}", config);

        // Create the stream based on the sample format
        let stream = match config.sample_format() {
            SampleFormat::I16 => Self::create_stream::<i16>(
                &device,
                &config.into(),
                callback,
                is_capturing,
            )?,
            SampleFormat::U16 => Self::create_stream::<u16>(
                &device,
                &config.into(),
                callback,
                is_capturing,
            )?,
            SampleFormat::F32 => Self::create_stream::<f32>(
                &device,
                &config.into(),
                callback,
                is_capturing,
            )?,
            sample_format => {
                return Err(anyhow::anyhow!(
                    "Unsupported sample format: {:?}",
                    sample_format
                ));
            }
        };

        // Start the stream
        stream.play()?;
        Ok(stream)
    }

    fn capture_audio_stream_with_sample_rate<F>(
        callback: F,
        is_capturing: Arc<Mutex<bool>>,
        _shutdown_receiver: Receiver<()>,
    ) -> Result<Stream>
    where
        F: Fn(Vec<i16>, u32) + Send + 'static,
    {
        // Get the default audio input device
        let device = cpal::default_host()
            .default_input_device()
            .ok_or_else(|| anyhow::anyhow!("No default input device available"))?;
        
        println!(
            "🎤 Using audio device: {}",
            device.name().unwrap_or_else(|_| "Unknown".to_string())
        );

        // Get the default config for the device
        let config = device.default_input_config()?;
        println!("📊 Default audio config: {:?}", config);
        let sample_rate = config.sample_rate().0;

        // Create the stream based on the sample format
        let stream = match config.sample_format() {
            SampleFormat::I16 => Self::create_stream_with_sample_rate::<i16>(
                &device,
                &config.into(),
                callback,
                is_capturing,
                sample_rate,
            )?,
            SampleFormat::U16 => Self::create_stream_with_sample_rate::<u16>(
                &device,
                &config.into(),
                callback,
                is_capturing,
                sample_rate,
            )?,
            SampleFormat::F32 => Self::create_stream_with_sample_rate::<f32>(
                &device,
                &config.into(),
                callback,
                is_capturing,
                sample_rate,
            )?,
            sample_format => {
                return Err(anyhow::anyhow!(
                    "Unsupported sample format: {:?}",
                    sample_format
                ));
            }
        };

        // Start the stream
        stream.play()?;
        Ok(stream)
    }

    fn create_stream<T>(
        device: &Device,
        config: &StreamConfig,
        callback: impl Fn(Vec<i16>) + Send + 'static,
        is_capturing: Arc<Mutex<bool>>,
    ) -> Result<Stream>
    where
        T: Sample + Send + 'static + cpal::SizedSample,
        i16: cpal::FromSample<T>,
    {
        let err_fn = |err| eprintln!("An error occurred on the audio stream: {}", err);
        
        let stream = device.build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                // Check if we should continue capturing
                if !*is_capturing.lock().unwrap() {
                    return;
                }
                
                // Convert samples to i16
                let audio_frame: Vec<i16> = data
                    .iter()
                    .map(|&sample| i16::from_sample(sample))
                    .collect();
                
                if !audio_frame.is_empty() {
                    callback(audio_frame);
                }
            },
            err_fn,
            None,
        )?;
        
        Ok(stream)
    }

    fn create_stream_with_sample_rate<T>(
        device: &Device,
        config: &StreamConfig,
        callback: impl Fn(Vec<i16>, u32) + Send + 'static,
        is_capturing: Arc<Mutex<bool>>,
        sample_rate: u32,
    ) -> Result<Stream>
    where
        T: Sample + Send + 'static + cpal::SizedSample,
        i16: cpal::FromSample<T>,
    {
        let err_fn = |err| eprintln!("An error occurred on the audio stream: {}", err);
        
        let stream = device.build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                // Check if we should continue capturing
                if !*is_capturing.lock().unwrap() {
                    return;
                }
                
                // Convert samples to i16
                let audio_frame: Vec<i16> = data
                    .iter()
                    .map(|&sample| i16::from_sample(sample))
                    .collect();
                
                if !audio_frame.is_empty() {
                    callback(audio_frame, sample_rate);
                }
            },
            err_fn,
            None,
        )?;
        
        Ok(stream)
    }

    pub fn stop_capture(&mut self) {
        *self.is_capturing.lock().unwrap() = false;

        // Send shutdown signal if available
        if let Some(sender) = self.shutdown_sender.take() {
            let _ = sender.send(());
        }

        // Drop the stream to stop capture
        self._stream = None;

        println!("🛑 Audio capture stopped");
    }
}

// Make AudioCapture thread-safe
unsafe impl Send for AudioCapture {}
unsafe impl Sync for AudioCapture {}