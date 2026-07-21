use bzip2::read::BzDecoder;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use futures_util::StreamExt;
use serde::Serialize;
use sherpa_onnx::{
    LinearResampler, OfflineRecognizer, OfflineRecognizerConfig, OfflineSenseVoiceModelConfig,
};
use std::{
    fs::File,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::ipc::Channel;

const MODEL_NAME: &str = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17";
const MODEL_ARCHIVE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2";
const MAX_RECORDING_SECONDS: u64 = 60;

const MODEL_MISSING: u8 = 0;
const MODEL_LOADING: u8 = 1;
const MODEL_READY: u8 = 2;
const MODEL_ERROR: u8 = 3;
const MODEL_DOWNLOADING: u8 = 4;

#[derive(Clone)]
pub struct VoiceState {
    model_root: Arc<PathBuf>,
    recognizer: Arc<Mutex<Option<OfflineRecognizer>>>,
    model_state: Arc<AtomicU8>,
    model_error: Arc<Mutex<String>>,
    downloaded_bytes: Arc<AtomicU64>,
    total_bytes: Arc<AtomicU64>,
    recording: Arc<AtomicBool>,
    transcribing: Arc<AtomicBool>,
    stop_signal: Arc<AtomicBool>,
    started_at: Arc<Mutex<Option<Instant>>>,
    transcript: Arc<Mutex<String>>,
    recording_error: Arc<Mutex<String>>,
}

impl VoiceState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            model_root: Arc::new(app_data_dir.join("voice-models")),
            recognizer: Arc::new(Mutex::new(None)),
            model_state: Arc::new(AtomicU8::new(MODEL_MISSING)),
            model_error: Arc::new(Mutex::new(String::new())),
            downloaded_bytes: Arc::new(AtomicU64::new(0)),
            total_bytes: Arc::new(AtomicU64::new(0)),
            recording: Arc::new(AtomicBool::new(false)),
            transcribing: Arc::new(AtomicBool::new(false)),
            stop_signal: Arc::new(AtomicBool::new(false)),
            started_at: Arc::new(Mutex::new(None)),
            transcript: Arc::new(Mutex::new(String::new())),
            recording_error: Arc::new(Mutex::new(String::new())),
        }
    }

    fn model_dir(&self) -> PathBuf {
        self.model_root.join(MODEL_NAME)
    }

    fn model_files_exist(&self) -> bool {
        let dir = self.model_dir();
        dir.join("model.int8.onnx").is_file() && dir.join("tokens.txt").is_file()
    }

    fn set_model_error(&self, message: impl Into<String>) {
        if let Ok(mut error) = self.model_error.lock() {
            *error = message.into();
        }
        self.model_state.store(MODEL_ERROR, Ordering::Relaxed);
    }

    fn load_recognizer(&self) -> Result<(), String> {
        let model_dir = self.model_dir();
        let model_path = model_dir.join("model.int8.onnx");
        let tokens_path = model_dir.join("tokens.txt");
        if !model_path.is_file() || !tokens_path.is_file() {
            return Err("语音模型文件不完整，请删除后重新下载。".into());
        }

        let mut config = OfflineRecognizerConfig::default();
        config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
            model: Some(path_text(&model_path)?),
            use_itn: true,
            ..Default::default()
        };
        config.model_config.tokens = Some(path_text(&tokens_path)?);
        config.model_config.num_threads = std::thread::available_parallelism()
            .map(|count| count.get().clamp(2, 4) as i32)
            .unwrap_or(2);
        config.model_config.debug = false;

        let recognizer = OfflineRecognizer::create(&config)
            .ok_or_else(|| "离线语音模型加载失败，请删除后重新下载。".to_string())?;
        *self
            .recognizer
            .lock()
            .map_err(|_| "语音识别器状态异常，请重启 Kardii。".to_string())? = Some(recognizer);
        if let Ok(mut error) = self.model_error.lock() {
            error.clear();
        }
        self.model_state.store(MODEL_READY, Ordering::Relaxed);
        Ok(())
    }

    pub fn initialize_if_installed(&self) {
        if !self.model_files_exist() {
            self.model_state.store(MODEL_MISSING, Ordering::Relaxed);
            return;
        }
        self.model_state.store(MODEL_LOADING, Ordering::Relaxed);
        let state = self.clone();
        std::thread::spawn(move || {
            if let Err(error) = state.load_recognizer() {
                state.set_model_error(error);
            }
        });
    }
}

fn path_text(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| "语音模型路径包含无法识别的字符。".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceModelStatus {
    state: String,
    error: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    installed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceDownloadEvent {
    event: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    message: String,
}

fn download_event(
    event: &str,
    downloaded_bytes: u64,
    total_bytes: u64,
    message: &str,
) -> VoiceDownloadEvent {
    VoiceDownloadEvent {
        event: event.into(),
        downloaded_bytes,
        total_bytes,
        message: message.into(),
    }
}

#[tauri::command]
pub fn get_voice_model_status(state: tauri::State<'_, VoiceState>) -> VoiceModelStatus {
    let code = state.model_state.load(Ordering::Relaxed);
    let label = match code {
        MODEL_LOADING => "loading",
        MODEL_READY => "ready",
        MODEL_ERROR => "error",
        MODEL_DOWNLOADING => "downloading",
        _ => "missing",
    };
    VoiceModelStatus {
        state: label.into(),
        error: state.model_error.lock().map(|value| value.clone()).unwrap_or_default(),
        downloaded_bytes: state.downloaded_bytes.load(Ordering::Relaxed),
        total_bytes: state.total_bytes.load(Ordering::Relaxed),
        installed: state.model_files_exist(),
    }
}

#[tauri::command]
pub async fn download_voice_model(
    on_event: Channel<VoiceDownloadEvent>,
    state: tauri::State<'_, VoiceState>,
) -> Result<(), String> {
    let state = state.inner().clone();
    let previous = state
        .model_state
        .compare_exchange(
            MODEL_MISSING,
            MODEL_DOWNLOADING,
            Ordering::SeqCst,
            Ordering::SeqCst,
        )
        .or_else(|current| {
            if current == MODEL_ERROR {
                state
                    .model_state
                    .compare_exchange(
                        MODEL_ERROR,
                        MODEL_DOWNLOADING,
                        Ordering::SeqCst,
                        Ordering::SeqCst,
                    )
            } else {
                Err(current)
            }
        });
    if let Err(current) = previous {
        return match current {
            MODEL_READY | MODEL_LOADING => Err("离线语音模型已经安装。".into()),
            MODEL_DOWNLOADING => Err("离线语音模型正在下载，请稍候。".into()),
            _ => Err("暂时无法开始下载，请重启 Kardii 后再试。".into()),
        };
    }

    if let Ok(mut error) = state.model_error.lock() {
        error.clear();
    }
    state.downloaded_bytes.store(0, Ordering::Relaxed);
    state.total_bytes.store(0, Ordering::Relaxed);
    let _ = on_event.send(download_event("starting", 0, 0, "正在连接官方模型下载地址……"));

    let result = download_and_install_model(&state, &on_event).await;
    if let Err(error) = &result {
        state.set_model_error(error.clone());
        let _ = on_event.send(download_event(
            "error",
            state.downloaded_bytes.load(Ordering::Relaxed),
            state.total_bytes.load(Ordering::Relaxed),
            error,
        ));
    }
    result
}

async fn download_and_install_model(
    state: &VoiceState,
    on_event: &Channel<VoiceDownloadEvent>,
) -> Result<(), String> {
    std::fs::create_dir_all(state.model_root.as_ref())
        .map_err(|error| format!("无法创建语音模型文件夹：{error}"))?;
    let archive_path = state.model_root.join(format!("{MODEL_NAME}.download"));
    let extract_root = state.model_root.join(".extracting");
    let _ = std::fs::remove_file(&archive_path);
    let _ = std::fs::remove_dir_all(&extract_root);

    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(|error| format!("无法创建下载任务：{error}"))?
        .get(MODEL_ARCHIVE_URL)
        .send()
        .await
        .map_err(|_| "无法连接语音模型下载地址，请检查网络后重试。".to_string())?;
    if !response.status().is_success() {
        return Err(format!("语音模型下载失败（{}）。", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    state.total_bytes.store(total, Ordering::Relaxed);
    let mut output = File::create(&archive_path)
        .map_err(|error| format!("无法保存语音模型：{error}"))?;
    let mut stream = response.bytes_stream();
    let mut downloaded = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "下载中断，请重新下载语音模型。".to_string())?;
        output
            .write_all(&chunk)
            .map_err(|error| format!("保存语音模型失败：{error}"))?;
        downloaded += chunk.len() as u64;
        state.downloaded_bytes.store(downloaded, Ordering::Relaxed);
        let _ = on_event.send(download_event(
            "progress",
            downloaded,
            total,
            "正在下载离线语音模型……",
        ));
    }
    output
        .flush()
        .map_err(|error| format!("保存语音模型失败：{error}"))?;
    drop(output);
    if downloaded < 1_000_000 || (total > 0 && downloaded != total) {
        let _ = std::fs::remove_file(&archive_path);
        return Err("下载的语音模型不完整，请重新下载。".into());
    }

    let _ = on_event.send(download_event(
        "extracting",
        downloaded,
        total,
        "下载完成，正在解压并检查模型……",
    ));
    std::fs::create_dir_all(&extract_root)
        .map_err(|error| format!("无法创建解压文件夹：{error}"))?;
    let file = File::open(&archive_path)
        .map_err(|error| format!("无法读取已下载的模型：{error}"))?;
    let decoder = BzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    archive
        .unpack(&extract_root)
        .map_err(|error| format!("语音模型解压失败：{error}"))?;

    let extracted_model = extract_root.join(MODEL_NAME);
    if !extracted_model.join("model.int8.onnx").is_file()
        || !extracted_model.join("tokens.txt").is_file()
    {
        let _ = std::fs::remove_file(&archive_path);
        let _ = std::fs::remove_dir_all(&extract_root);
        return Err("解压后的语音模型文件不完整，请重新下载。".into());
    }

    let final_model = state.model_dir();
    let _ = std::fs::remove_dir_all(&final_model);
    std::fs::rename(&extracted_model, &final_model)
        .map_err(|error| format!("无法安装语音模型：{error}"))?;
    let _ = std::fs::remove_file(&archive_path);
    let _ = std::fs::remove_dir_all(&extract_root);

    state.model_state.store(MODEL_LOADING, Ordering::Relaxed);
    state.load_recognizer()?;
    let _ = on_event.send(download_event(
        "ready",
        downloaded,
        total,
        "离线语音已经准备好。",
    ));
    Ok(())
}

#[tauri::command]
pub fn delete_voice_model(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    let state = state.inner().clone();
    if state.recording.load(Ordering::Relaxed) || state.transcribing.load(Ordering::Relaxed) {
        return Err("请先结束当前录音。".into());
    }
    if state.model_state.load(Ordering::Relaxed) == MODEL_DOWNLOADING {
        return Err("模型正在下载，暂时不能删除。".into());
    }
    if let Ok(mut recognizer) = state.recognizer.lock() {
        *recognizer = None;
    }
    let model_dir = state.model_dir();
    if model_dir.exists() {
        std::fs::remove_dir_all(&model_dir)
            .map_err(|error| format!("删除语音模型失败：{error}"))?;
    }
    state.downloaded_bytes.store(0, Ordering::Relaxed);
    state.total_bytes.store(0, Ordering::Relaxed);
    state.model_state.store(MODEL_MISSING, Ordering::Relaxed);
    if let Ok(mut error) = state.model_error.lock() {
        error.clear();
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceRecordingState {
    phase: String,
    elapsed_secs: f32,
    text: String,
    error: String,
}

fn build_input_stream(
    device: &cpal::Device,
    sender: mpsc::Sender<Vec<f32>>,
) -> Result<cpal::Stream, String> {
    let supported = device
        .default_input_config()
        .map_err(|error| format!("无法读取麦克风格式：{error}"))?;
    let config = supported.config();
    let channels = config.channels as usize;
    if channels == 0 {
        return Err("麦克风没有可用的声道。".into());
    }
    let error_callback = |error| eprintln!("Kardii microphone stream error: {error}");

    match supported.sample_format() {
        SampleFormat::F32 => device
            .build_input_stream(
                &config,
                move |data: &[f32], _| {
                    let mono = data
                        .chunks(channels)
                        .map(|frame| frame.iter().copied().sum::<f32>() / channels as f32)
                        .collect();
                    let _ = sender.send(mono);
                },
                error_callback,
                None,
            )
            .map_err(|error| format!("无法打开麦克风：{error}")),
        SampleFormat::I16 => device
            .build_input_stream(
                &config,
                move |data: &[i16], _| {
                    let mono = data
                        .chunks(channels)
                        .map(|frame| {
                            frame
                                .iter()
                                .map(|sample| *sample as f32 / i16::MAX as f32)
                                .sum::<f32>()
                                / channels as f32
                        })
                        .collect();
                    let _ = sender.send(mono);
                },
                error_callback,
                None,
            )
            .map_err(|error| format!("无法打开麦克风：{error}")),
        SampleFormat::U16 => device
            .build_input_stream(
                &config,
                move |data: &[u16], _| {
                    let mono = data
                        .chunks(channels)
                        .map(|frame| {
                            frame
                                .iter()
                                .map(|sample| (*sample as f32 - 32768.0) / 32768.0)
                                .sum::<f32>()
                                / channels as f32
                        })
                        .collect();
                    let _ = sender.send(mono);
                },
                error_callback,
                None,
            )
            .map_err(|error| format!("无法打开麦克风：{error}")),
        format => Err(format!("暂不支持这个麦克风音频格式：{format:?}")),
    }
}

fn capture_microphone(state: &VoiceState) -> Result<Vec<f32>, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "没有找到可用的麦克风，请检查系统声音设置。".to_string())?;
    let sample_rate = device
        .default_input_config()
        .map_err(|error| format!("无法读取麦克风设置：{error}"))?
        .sample_rate()
        .0 as i32;
    let resampler = if sample_rate == 16_000 {
        None
    } else {
        Some(
            LinearResampler::create(sample_rate, 16_000)
                .ok_or_else(|| "无法把麦克风音频转换为识别格式。".to_string())?,
        )
    };
    let (sender, receiver) = mpsc::channel::<Vec<f32>>();
    let stream = build_input_stream(&device, sender)?;
    stream
        .play()
        .map_err(|error| format!("麦克风启动失败：{error}"))?;

    let start = Instant::now();
    let mut audio = Vec::new();
    while !state.stop_signal.load(Ordering::Relaxed)
        && start.elapsed().as_secs() < MAX_RECORDING_SECONDS
    {
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(samples) => {
                if let Some(resampler) = &resampler {
                    audio.extend(resampler.resample(&samples, false));
                } else {
                    audio.extend(samples);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("麦克风连接中断，请重新录音。".into())
            }
        }
    }
    drop(stream);
    Ok(audio)
}

fn recognize_audio(state: &VoiceState, audio: &[f32]) -> Result<String, String> {
    if audio.len() < 4_000 {
        return Err("录音太短，没有听清。请靠近麦克风再说一次。".into());
    }
    let recognizer = state
        .recognizer
        .lock()
        .map_err(|_| "语音识别器状态异常，请重启 Kardii。".to_string())?;
    let recognizer = recognizer
        .as_ref()
        .ok_or_else(|| "离线语音模型还没有准备好。".to_string())?;
    let stream = recognizer.create_stream();
    stream.accept_waveform(16_000, audio);
    recognizer.decode(&stream);
    let text = stream
        .get_result()
        .map(|result| result.text.trim().to_string())
        .unwrap_or_default();
    if text.is_empty() {
        return Err("没有识别到清楚的语音，请靠近麦克风再说一次。".into());
    }
    Ok(text)
}

#[tauri::command]
pub fn start_voice_recording(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    if state.model_state.load(Ordering::Relaxed) != MODEL_READY {
        return Err("请先在设置中下载并准备好离线语音模型。".into());
    }
    if state.transcribing.load(Ordering::Relaxed) {
        return Err("上一段语音还在识别，请稍候。".into());
    }
    if state.recording.swap(true, Ordering::SeqCst) {
        return Err("已经在录音了。".into());
    }
    state.stop_signal.store(false, Ordering::Relaxed);
    if let Ok(mut value) = state.transcript.lock() {
        value.clear();
    }
    if let Ok(mut value) = state.recording_error.lock() {
        value.clear();
    }
    if let Ok(mut value) = state.started_at.lock() {
        *value = Some(Instant::now());
    }

    let state = state.inner().clone();
    std::thread::spawn(move || {
        let captured = capture_microphone(&state);
        state.recording.store(false, Ordering::Relaxed);
        state.transcribing.store(true, Ordering::Relaxed);
        let result = captured.and_then(|audio| recognize_audio(&state, &audio));
        match result {
            Ok(text) => {
                if let Ok(mut transcript) = state.transcript.lock() {
                    *transcript = text;
                }
            }
            Err(error) => {
                if let Ok(mut message) = state.recording_error.lock() {
                    *message = error;
                }
            }
        }
        state.transcribing.store(false, Ordering::Relaxed);
    });
    Ok(())
}

#[tauri::command]
pub fn stop_voice_recording(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    if !state.recording.load(Ordering::Relaxed) {
        return Err("当前没有正在进行的录音。".into());
    }
    state.stop_signal.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn get_voice_recording_state(
    state: tauri::State<'_, VoiceState>,
) -> VoiceRecordingState {
    let recording = state.recording.load(Ordering::Relaxed);
    let transcribing = state.transcribing.load(Ordering::Relaxed);
    let text = state.transcript.lock().map(|value| value.clone()).unwrap_or_default();
    let error = state
        .recording_error
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let elapsed = state
        .started_at
        .lock()
        .ok()
        .and_then(|value| *value)
        .map(|start| start.elapsed().as_secs_f32().min(MAX_RECORDING_SECONDS as f32))
        .unwrap_or(0.0);
    let phase = if recording {
        "recording"
    } else if transcribing {
        "transcribing"
    } else if !error.is_empty() {
        "error"
    } else if !text.is_empty() {
        "done"
    } else {
        "idle"
    };
    VoiceRecordingState {
        phase: phase.into(),
        elapsed_secs: elapsed,
        text,
        error,
    }
}

#[tauri::command]
pub fn clear_voice_recording_result(state: tauri::State<'_, VoiceState>) {
    if let Ok(mut value) = state.transcript.lock() {
        value.clear();
    }
    if let Ok(mut value) = state.recording_error.lock() {
        value.clear();
    }
    if let Ok(mut value) = state.started_at.lock() {
        *value = None;
    }
}
