# LingtiVideo

Lingti means **greyhound** in Chinese, the fastest dog.  
**LingtiVideo** helps you generate videos fast: idea -> script -> review -> assets -> clips -> final video.

[中文说明 / Chinese Guide](./README-CN.md)

---

## What It Is

LingtiVideo is an open-source AI video workflow for local use.

It combines:
- script generation
- human review before expensive generation starts
- keyframe image generation
- TTS voiceover
- image-to-video generation
- FFmpeg assembly
- subtitle export
- JianYing / CapCut draft generation

It is designed for creators who want a recoverable production workflow instead of a one-shot black box.

---

## Current Stack

- Backend: FastAPI
- Frontend: Next.js + Ant Design
- LLM: DeepSeek / MiniMax / Gemini / OpenAI / Kimi / Zhipu / Ollama
- Image: MiniMax Image / Gemini image generation
- Video: Kling / Seedance
- TTS: MiniMax
- Assembly: FFmpeg

---

## First-Run Experience

When the web UI detects missing required configuration, it automatically opens a setup dialog.

You can configure:
- default LLM provider and model
- image provider and model
- video provider and model
- TTS model
- API keys for the selected services

Settings are written to:

```bash
configs/config.yaml
```

If you prefer manual setup, copy the example file first:

```bash
cp configs/config.example.yaml configs/config.yaml
```

---

## Quick Start

### 1. Requirements

- Python 3.10+
- Node.js 18+
- FFmpeg in PATH

Check FFmpeg:

```bash
ffmpeg -version
```

### 2. Install

```bash
git clone https://github.com/your-org/LingtiVideo.git
cd LingtiVideo

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cd frontend
yarn install
cd ..
```

### 3. Start backend

```bash
.venv/bin/python -m uvicorn api.server:app --host 0.0.0.0 --port 8000
```

### 4. Start frontend

```bash
cd frontend
yarn dev --port 3001
```

Open:

```text
http://127.0.0.1:3001
```

If the config is incomplete, the setup dialog will appear automatically.

---

## CLI

Run a generation task directly:

```bash
.venv/bin/python cli/main.py run --topic "A modern retirement hotel near Shanghai, 40 seconds"
```

Test connectors:

```bash
.venv/bin/python cli/main.py test --module llm
.venv/bin/python cli/main.py test --module image
.venv/bin/python cli/main.py test --module tts
.venv/bin/python cli/main.py test --module video
```

---

## Web UI

Main routes:

- `/` Home
- `/create` Quick generation
- `/studio` Pro workspace
- `/analyze` Reference video analysis
- `/settings` Setup and connectors

Highlights:

- first-run setup modal
- provider/model friendly config editing
- script review before generation
- resumable projects
- live console logs
- downloadable final video, subtitles, and JianYing draft

---

## TTS Behavior

The built-in voice catalog and voice preview are currently available only for **MiniMax TTS**.

If the active TTS provider does not support the MiniMax voice catalog, the UI switches from:

- voice picker

to:

- manual `voice_id` input

This keeps the interface usable for custom or externally managed voice setups.

---

## Project Structure

```text
api/                FastAPI backend
cli/                CLI entrypoints
core/               Config loader and shared settings
modules/            LLM / image / TTS / video / assembly modules
frontend/           Next.js frontend
configs/            Example and local config files
data/               Outputs, uploads, cache, local runtime data
```

---

## Notes

- This project is optimized for local workflows, not multi-tenant SaaS deployment.
- Some providers are configurable at the UI layer before every backend path is fully generalized.
- FFmpeg features depend on your local build. If subtitle burn-in is unavailable, LingtiVideo can still output MP4 + SRT.

---

## License

MIT
