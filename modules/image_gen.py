"""
噼哩噼哩 Pilipili-AutoVideo
图像生成模块 - Nano Banana (Gemini Image Generation)

职责：
- 为每个分镜生成高质量 1080P 首帧关键图
- 支持多参考图注入（角色一致性）
- 支持风格参考图
- 异步并发生成，提升效率

会话级模型黑名单机制：
- 一旦某个模型在本次任务中出现 503/超时，立即加入 _FAILED_MODELS 集合
- 后续所有 Scene 直接跳过黑名单中的模型，不再浪费时间重试
- 黑名单仅在进程生命周期内有效，重启后自动清空
"""

import os
import asyncio
import base64
import concurrent.futures
import time
import requests
from pathlib import Path
from typing import Optional
from google import genai
from google.genai import types
try:
    from PIL import Image, ImageDraw
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False

from core.config import PilipiliConfig, get_config
from modules.llm import Scene


# ============================================================
# 会话级模型黑名单（进程级单例，重启自动清空）
# ============================================================
_FAILED_MODELS: set[str] = set()
_MINIMAX_REQUEST_TIMEOUT = (20, 300)
_MINIMAX_DOWNLOAD_TIMEOUT = (20, 120)
_MINIMAX_MAX_RETRIES = 3


def _mark_model_failed(model_name: str, reason: str, verbose: bool = False) -> None:
    """将模型加入黑名单，本次任务不再使用"""
    if model_name not in _FAILED_MODELS:
        _FAILED_MODELS.add(model_name)
        if verbose:
            print(f"[ImageGen] ⚠️  模型 {model_name} 已加入黑名单（{reason}），本次任务后续分镜将跳过此模型")


def reset_failed_models() -> None:
    """手动清空黑名单（供测试或新任务调用）"""
    _FAILED_MODELS.clear()


def _looks_like_google_api_key(value: str) -> bool:
    return value.strip().startswith("AIza")


def _looks_like_placeholder(value: str) -> bool:
    normalized = value.strip()
    if not normalized:
        return True
    return normalized.startswith("YOUR_") or normalized in {"your_api_key", "replace_me", "ollama"}


def _resolve_image_provider(config: PilipiliConfig) -> str:
    provider = (config.image_gen.provider or "nano_banana").strip().lower()
    if provider in {"gemini", "nano-banana"}:
        return "nano_banana"
    return provider


def _resolve_image_api_key(config: PilipiliConfig) -> str:
    provider = _resolve_image_provider(config)
    image_key = (config.image_gen.api_key or "").strip()

    if provider == "minimax":
        if image_key and not _looks_like_placeholder(image_key) and not _looks_like_google_api_key(image_key):
            return image_key
        llm_key = (config.llm.minimax.api_key or "").strip()
        if llm_key and not _looks_like_placeholder(llm_key):
            return llm_key
        tts_key = (config.tts.api_key or "").strip()
        if tts_key and not _looks_like_placeholder(tts_key):
            return tts_key
        return image_key

    if image_key and not _looks_like_placeholder(image_key):
        return image_key
    gemini_key = (config.llm.gemini.api_key or "").strip()
    return gemini_key


def _resolve_image_model(config: PilipiliConfig) -> str:
    provider = _resolve_image_provider(config)
    configured_model = (config.image_gen.model or "").strip()

    if provider == "minimax":
        return configured_model if configured_model.startswith("image-") else "image-01"

    return configured_model or "gemini-2.0-flash-preview-image-generation"


def _aspect_ratio_to_size(aspect_ratio: str) -> tuple[int, int]:
    if aspect_ratio == "16:9":
        return 1280, 720
    if aspect_ratio == "3:4":
        return 1152, 1536
    return 720, 1280


def _build_minimax_subject_reference(reference_images: Optional[list[str]], verbose: bool = False) -> list[dict]:
    refs: list[dict] = []
    for ref in reference_images or []:
        if ref.startswith("http://") or ref.startswith("https://"):
            refs.append({"type": "image_url", "image_url": ref})
        elif verbose:
            print(f"[ImageGen] MiniMax 暂不支持本地参考图直传，已跳过: {ref}")
    return refs


def _request_with_retries(
    method: str,
    url: str,
    *,
    timeout: tuple[int, int] | int,
    verbose: bool = False,
    retry_label: str = "request",
    **kwargs,
) -> requests.Response:
    last_error: Exception | None = None

    for attempt in range(1, _MINIMAX_MAX_RETRIES + 1):
        try:
            response = requests.request(method, url, timeout=timeout, **kwargs)
            if response.status_code in {429, 500, 502, 503, 504}:
                raise RuntimeError(f"{retry_label} temporary failure (HTTP {response.status_code})")
            return response
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError, RuntimeError) as exc:
            last_error = exc
            if attempt >= _MINIMAX_MAX_RETRIES:
                break
            sleep_seconds = min(2 ** (attempt - 1), 8)
            if verbose:
                print(
                    f"[ImageGen] {retry_label} 第 {attempt} 次失败: {exc}. "
                    f"{sleep_seconds}s 后重试..."
                )
            time.sleep(sleep_seconds)

    raise RuntimeError(
        f"{retry_label} 连续 {_MINIMAX_MAX_RETRIES} 次失败: {last_error}"
    )


def _extract_minimax_image_bytes(response_json: dict) -> bytes:
    data = response_json.get("data")
    if isinstance(data, dict):
        image_urls = data.get("image_urls") or []
        if image_urls:
            download = _request_with_retries(
                "get",
                image_urls[0],
                timeout=_MINIMAX_DOWNLOAD_TIMEOUT,
                retry_label="MiniMax 图片下载",
            )
            download.raise_for_status()
            return download.content

    if isinstance(data, dict):
        candidates = data.get("images") or data.get("image_list") or data.get("data") or []
    else:
        candidates = data or []

    if isinstance(candidates, dict):
        candidates = [candidates]

    for item in candidates:
        if not isinstance(item, dict):
            continue
        b64 = item.get("base64") or item.get("b64_json")
        if b64:
            return base64.b64decode(b64)
        url = item.get("url") or item.get("image_url")
        if url:
            download = _request_with_retries(
                "get",
                url,
                timeout=_MINIMAX_DOWNLOAD_TIMEOUT,
                retry_label="MiniMax 图片下载",
            )
            download.raise_for_status()
            return download.content

    raise RuntimeError(f"MiniMax 图片生成响应中未找到图片数据: {response_json}")


def _generate_keyframe_minimax_sync(
    scene: Scene,
    output_path: str,
    api_key: str,
    model: str,
    reference_images: Optional[list[str]] = None,
    style_reference: Optional[str] = None,
    verbose: bool = False,
    aspect_ratio: str = "9:16",
    global_style_prompt: str = "",
) -> str:
    style_str = ", ".join(scene.style_tags) if scene.style_tags else ""
    full_prompt = scene.image_prompt
    if style_str:
        full_prompt = f"{full_prompt}, style: {style_str}"
    if global_style_prompt:
        full_prompt = f"{full_prompt}. GLOBAL STYLE LOCK: {global_style_prompt}"
    if style_reference:
        full_prompt = f"{full_prompt}. Match the color palette and aesthetic tone of the provided style reference."

    payload = {
        "model": model,
        "prompt": (
            f"{full_prompt}, ultra high quality, cinematic composition, sharp focus, "
            f"{'vertical portrait composition' if aspect_ratio in ('9:16', '3:4') else 'horizontal landscape composition'}"
        ),
        "n": 1,
        "aspect_ratio": aspect_ratio,
        "response_format": "url",
        "prompt_optimizer": True,
    }

    subject_reference = _build_minimax_subject_reference(reference_images, verbose=verbose)
    if subject_reference:
        payload["subject_reference"] = subject_reference

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    response = _request_with_retries(
        "post",
        "https://api.minimaxi.com/v1/image_generation",
        json=payload,
        headers=headers,
        timeout=_MINIMAX_REQUEST_TIMEOUT,
        verbose=verbose,
        retry_label=f"MiniMax 生图 Scene {scene.scene_id}",
    )

    if response.status_code >= 400:
        raise RuntimeError(f"MiniMax 图片生成失败 (HTTP {response.status_code}): {response.text[:500]}")

    image_bytes = _extract_minimax_image_bytes(response.json())
    with open(output_path, "wb") as f:
        f.write(image_bytes)

    if verbose:
        print(f"[ImageGen] Scene {scene.scene_id} 使用 MiniMax 关键帧已保存: {output_path}")

    return output_path


# ============================================================
# 图像生成核心函数
# ============================================================

async def generate_keyframe(
    scene: Scene,
    output_dir: str,
    reference_images: Optional[list[str]] = None,
    style_reference: Optional[str] = None,
    config: Optional[PilipiliConfig] = None,
    verbose: bool = False,
    aspect_ratio: str = "9:16",
    global_style_prompt: str = "",
) -> str:
    """
    为单个分镜生成关键帧图片

    Args:
        scene: 分镜场景对象
        output_dir: 输出目录
        reference_images: 角色/主体参考图路径列表（用于主体一致性）
        style_reference: 风格参考图路径
        config: 配置对象
        verbose: 是否打印调试信息

    Returns:
        生成的图片本地路径
    """
    if config is None:
        config = get_config()

    os.makedirs(output_dir, exist_ok=True)

    # 输出路径
    output_path = os.path.join(output_dir, f"scene_{scene.scene_id:03d}_keyframe.png")

    # 如果已存在，跳过（断点续传）
    if os.path.exists(output_path):
        if verbose:
            print(f"[ImageGen] Scene {scene.scene_id} 关键帧已存在，跳过生成")
        return output_path

    provider = _resolve_image_provider(config)
    api_key = _resolve_image_api_key(config)
    if not api_key:
        if provider == "minimax":
            raise ValueError("MiniMax 图片生成 API Key 未配置，请设置 image_gen.api_key 或 llm.minimax.api_key")
        raise ValueError("Nano Banana (Gemini) API Key 未配置，请在 config.yaml 中设置 image_gen.api_key")

    if provider == "minimax":
        return await asyncio.to_thread(
            _generate_keyframe_minimax_sync,
            scene,
            output_path,
            api_key,
            _resolve_image_model(config),
            reference_images,
            style_reference,
            verbose,
            aspect_ratio,
            global_style_prompt,
        )

    client = genai.Client(api_key=api_key)

    # 构建提示词：基础提示词 + 风格标签
    style_str = ", ".join(scene.style_tags) if scene.style_tags else ""
    full_prompt = scene.image_prompt
    if style_str:
        full_prompt = f"{full_prompt}, style: {style_str}"

    # 添加全局风格锁定（防止风格漂移）
    if global_style_prompt:
        full_prompt = f"{full_prompt}. GLOBAL STYLE LOCK: {global_style_prompt}"

    # 根据 aspect_ratio 设置图片方向提示
    if aspect_ratio in ("9:16", "3:4"):
        orientation_hint = "vertical portrait orientation (9:16 aspect ratio, taller than wide)"
    else:
        orientation_hint = "horizontal landscape orientation (16:9 aspect ratio, wider than tall)"

    # 添加质量提示词
    full_prompt = (
        f"{full_prompt}, "
        f"ultra high quality, 1080P resolution, cinematic composition, "
        f"professional photography, sharp focus, detailed, "
        f"{orientation_hint}"
    )

    if verbose:
        print(f"[ImageGen] Scene {scene.scene_id} 生成关键帧")
        print(f"[ImageGen] Prompt: {full_prompt[:100]}...")

    # 构建多模态内容（支持参考图注入）
    contents = []

    # 添加参考图（角色一致性）
    if reference_images:
        ref_parts = []
        for ref_path in reference_images:
            if os.path.exists(ref_path):
                with open(ref_path, "rb") as f:
                    img_data = f.read()
                mime_type = _detect_mime_type(ref_path)
                ref_parts.append(
                    types.Part.from_bytes(data=img_data, mime_type=mime_type)
                )
        if ref_parts:
            contents.extend(ref_parts)
            contents.append(types.Part.from_text(
                text=(
                    "CRITICAL CHARACTER CONSISTENCY INSTRUCTION (HIGHEST PRIORITY): "
                    "The reference image(s) above show the EXACT male protagonist character. "
                    "You MUST generate an image where this EXACT SAME PERSON appears. "
                    "MANDATORY requirements (violation = failure): "
                    "1) IDENTICAL face shape, jawline, eyes, nose, mouth - pixel-level facial match. "
                    "2) IDENTICAL hairstyle, hair color, hair length, hair texture. "
                    "3) IDENTICAL clothing: same suit/shirt/outfit color, style, fit. "
                    "4) IDENTICAL body type, height proportions, skin tone. "
                    "5) IDENTICAL accessories (glasses, watch, tie, etc). "
                    "The output MUST look like a photo of the SAME REAL PERSON in a different scene. "
                    "Do NOT create a different person who merely looks similar. "
                    "Do NOT change the character's ethnicity, age, or gender. "
                    "CHARACTER IDENTITY PRESERVATION IS THE #1 PRIORITY - above artistic style or scene accuracy."
                )
            ))

    # 添加风格参考图
    if style_reference and os.path.exists(style_reference):
        with open(style_reference, "rb") as f:
            style_data = f.read()
        mime_type = _detect_mime_type(style_reference)
        contents.append(types.Part.from_bytes(data=style_data, mime_type=mime_type))
        contents.append(types.Part.from_text(
            text="Please use the visual style, color palette and aesthetic shown in the style reference image above."
        ))

    # 添加主提示词
    contents.append(types.Part.from_text(text=full_prompt))

    # -------------------------------------------------------
    # 模型 fallback 列表（均经过 ListModels 确认存在）
    # 会话级黑名单：已失败的模型直接跳过，不再重试
    # -------------------------------------------------------
    FALLBACK_MODELS = [
        _resolve_image_model(config),                  # config 配置的主模型
        "models/gemini-2.5-flash-image",               # 备选：2.5 Flash 图像版（经 ListModels 确认存在）
        "models/gemini-3.1-flash-image-preview",       # 备选：3.1 Flash 图像预览（经 ListModels 确认存在）
    ]
    # 去重保序
    seen: set[str] = set()
    model_list = [m for m in FALLBACK_MODELS if not (m in seen or seen.add(m))]

    # 过滤掉本次任务已知失败的模型
    available_models = [m for m in model_list if m not in _FAILED_MODELS]
    if not available_models:
        raise RuntimeError(
            f"Scene {scene.scene_id} 所有图像模型均已加入黑名单，无可用模型。"
            "请重启后端以重置黑名单，或检查 API Key 是否有效。"
        )

    if verbose and len(available_models) < len(model_list):
        skipped = [m for m in model_list if m in _FAILED_MODELS]
        print(f"[ImageGen] Scene {scene.scene_id} 跳过黑名单模型: {skipped}")

    IMAGE_GEN_TIMEOUT = 60  # 秒，超时后自动切换下一个模型

    last_err = None
    response = None

    for model_name in available_models:
        try:
            if verbose and model_name != _resolve_image_model(config):
                print(f"[ImageGen] 使用备用模型: {model_name}")
            elif verbose:
                print(f"[ImageGen] 使用模型: {model_name}")

            # 重要：不能用 with 语句，否则超时后 __exit__ 会调用 shutdown(wait=True) 导致永久卡住
            executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
            future = executor.submit(
                client.models.generate_content,
                model=model_name,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"],
                )
            )
            try:
                response = future.result(timeout=IMAGE_GEN_TIMEOUT)
            except concurrent.futures.TimeoutError:
                # 放弃等待卡住的线程，直接切换下一个模型
                executor.shutdown(wait=False, cancel_futures=True)
                _mark_model_failed(model_name, f"超时 {IMAGE_GEN_TIMEOUT}s", verbose)
                last_err = TimeoutError(f"模型 {model_name} 超时")
                response = None
                if verbose:
                    remaining = [m for m in available_models if m not in _FAILED_MODELS]
                    if remaining:
                        print(f"[ImageGen] Scene {scene.scene_id} 切换到下一个模型: {remaining[0]}")
                    else:
                        print(f"[ImageGen] Scene {scene.scene_id} 所有模型均已失败")
                continue
            else:
                executor.shutdown(wait=False)

            break  # 成功则退出循环

        except Exception as e:
            last_err = e
            err_str = str(e)
            if "404" in err_str:
                # 模型不存在，加入黑名单
                _mark_model_failed(model_name, "404 模型不存在", verbose)
                continue
            elif "503" in err_str or "UNAVAILABLE" in err_str:
                _mark_model_failed(model_name, "503 服务不可用", verbose)
                continue
            elif "429" in err_str:
                # 区分两种 429：账户超限 vs RPM 限速
                if "spending cap" in err_str.lower():
                    # 账户额度耗尽（spending cap），等待无效，直接抛出友好错误
                    raise RuntimeError(
                        f"Gemini API 账户额度已耗尽（spending cap exceeded）。"
                        f"请前往 https://aistudio.google.com/ 检查并提升消费上限后重试。"
                        f"原始错误: {err_str}"
                    )
                else:
                    # RPM 限速，等待 30s 后重试当前模型（不加入黑名单）
                    if verbose:
                        print(f"[ImageGen] ⚠️  模型 {model_name} 触发 RPM 限速，等待 30s 后重试...")
                    import time
                    time.sleep(30)
                    # 重试当前模型（通过 continue 跳过，但不加黑名单，下次循环会再试）
                    # 注意：for 循环不会重试同一个 model_name，所以这里直接 continue 到下一个
                    _mark_model_failed(model_name, "429 RPM 限速（已等待30s仍失败）", verbose)
                    continue
            else:
                raise  # 其他未知错误直接抛出

    if response is None:
        raise RuntimeError(f"Scene {scene.scene_id} 所有图像模型均不可用: {last_err}")

    # 提取图片数据（防御性检查：candidates / content / parts 均可能为 None）
    image_saved = False
    candidates = response.candidates if response.candidates else []
    for candidate in candidates:
        content = candidate.content if candidate else None
        if content is None:
            continue
        parts = content.parts if content.parts else []
        for part in parts:
            if part.inline_data is not None:
                img_data = part.inline_data.data
                if isinstance(img_data, str):
                    img_data = base64.b64decode(img_data)
                with open(output_path, "wb") as f:
                    f.write(img_data)
                image_saved = True
                break
        if image_saved:
            break

    if not image_saved:
        finish_reason = None
        text_response = ""
        if candidates and candidates[0]:
            finish_reason = getattr(candidates[0], 'finish_reason', None)
            try:
                content = candidates[0].content
                if content and content.parts:
                    for part in content.parts:
                        if hasattr(part, 'text') and part.text:
                            text_response += part.text
            except Exception:
                pass
        if verbose and text_response:
            print(f"[ImageGen] Scene {scene.scene_id} API 返回文本（未生成图片）: {text_response[:300]}")

        # IMAGE_SAFETY 拦截：先用简化 prompt 重试一次
        finish_reason_str = str(finish_reason)
        if "IMAGE_SAFETY" in finish_reason_str or "SAFETY" in finish_reason_str:
            if verbose:
                print(f"[ImageGen] Scene {scene.scene_id} 触发安全过滤，尝试用简化 prompt 重试...")
            # 简化 prompt：去掉人物描述，只保留场景和环境
            safe_prompt = _make_safe_prompt(scene)
            safe_contents = [types.Part.from_text(text=safe_prompt)]
            safe_response = None
            for model_name in available_models:
                executor2 = concurrent.futures.ThreadPoolExecutor(max_workers=1)
                future2 = executor2.submit(
                    client.models.generate_content,
                    model=model_name,
                    contents=safe_contents,
                    config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"]),
                )
                try:
                    safe_response = future2.result(timeout=IMAGE_GEN_TIMEOUT)
                    executor2.shutdown(wait=False)
                    break
                except Exception:
                    executor2.shutdown(wait=False, cancel_futures=True)
                    continue
            if safe_response:
                safe_candidates = safe_response.candidates or []
                for cand in safe_candidates:
                    cparts = (cand.content.parts if cand.content else []) or []
                    for p in cparts:
                        if p.inline_data is not None:
                            img_data = p.inline_data.data
                            if isinstance(img_data, str):
                                img_data = base64.b64decode(img_data)
                            with open(output_path, "wb") as f:
                                f.write(img_data)
                            image_saved = True
                            if verbose:
                                print(f"[ImageGen] Scene {scene.scene_id} 简化 prompt 重试成功")
                            break
                    if image_saved:
                        break

        # 仍失败：生成纯色占位图，让流程继续
        if not image_saved:
            _create_placeholder_image(output_path, scene.scene_id, verbose, aspect_ratio=aspect_ratio)
            image_saved = True
            if verbose:
                print(f"[ImageGen] Scene {scene.scene_id} 已使用占位图替代，流程继续")

    if verbose:
        print(f"[ImageGen] Scene {scene.scene_id} 关键帧已保存: {output_path}")

    return output_path


async def generate_all_keyframes(
    scenes: list[Scene],
    output_dir: str,
    reference_images: Optional[list[str]] = None,
    style_reference: Optional[str] = None,
    style_reference_map: Optional[dict[int, str]] = None,
    config: Optional[PilipiliConfig] = None,
    max_concurrent: int = 3,
    verbose: bool = False,
    characters: Optional[list] = None,  # list[CharacterInfo]
    aspect_ratio: str = "9:16",
    global_style_prompt: str = "",
) -> dict[int, str]:
    """
    并发生成所有分镜的关键帧

    Args:
        scenes: 分镜列表
        output_dir: 输出目录
        reference_images: 全局角色参考图
        style_reference: 全局风格参考图
        config: 配置对象
        max_concurrent: 最大并发数（避免 API 限速）
        verbose: 是否打印调试信息
        characters: 角色列表（CharacterInfo），无参考图时用 appearance_prompt 增强一致性

    Returns:
        {scene_id: image_path} 字典
    """
    # 构建 character_id -> CharacterInfo 映射
    char_map: dict[int, object] = {}
    if characters:
        for char in characters:
            cid = char.character_id if hasattr(char, 'character_id') else char.get('character_id')
            if cid is not None:
                char_map[cid] = char

    effective_concurrency = max_concurrent
    provider = _resolve_image_provider(config or get_config())
    if provider == "minimax":
        effective_concurrency = 1
        if verbose and max_concurrent != effective_concurrency:
            print(f"[ImageGen] MiniMax provider 已自动降级并发到 {effective_concurrency}，避免请求超时")

    semaphore = asyncio.Semaphore(effective_concurrency)
    results = {}

    async def _generate_with_semaphore(scene: Scene):
        async with semaphore:
            # 优先使用场景级别的角色参考图
            scene_refs = None
            if scene.character_refs:
                refs = [ref for ref in scene.character_refs if ref and os.path.exists(ref)]
                if refs:
                    scene_refs = refs
            elif scene.reference_character and os.path.exists(scene.reference_character):
                scene_refs = [scene.reference_character]
            elif reference_images:
                scene_refs = reference_images

            scene_style_reference = (style_reference_map or {}).get(scene.scene_id) or style_reference

            # 如果没有参考图，尝试用 appearance_prompt 增强 image_prompt
            enhanced_scene = scene
            if not scene_refs and char_map and scene.characters_in_scene:
                appearance_parts = []
                for cid in scene.characters_in_scene:
                    char = char_map.get(cid)
                    if char:
                        ap = char.appearance_prompt if hasattr(char, 'appearance_prompt') else char.get('appearance_prompt', '')
                        if ap:
                            appearance_parts.append(ap)
                if appearance_parts:
                    from dataclasses import replace as dc_replace
                    extra = "; ".join(appearance_parts)
                    new_prompt = f"{scene.image_prompt}. CHARACTER APPEARANCE (maintain consistency): {extra}"
                    enhanced_scene = dc_replace(scene, image_prompt=new_prompt)

            path = await generate_keyframe(
                scene=enhanced_scene,
                output_dir=output_dir,
                reference_images=scene_refs,
                style_reference=scene_style_reference,
                config=config,
                verbose=verbose,
                aspect_ratio=aspect_ratio,
                global_style_prompt=global_style_prompt,
            )
            results[scene.scene_id] = path

    tasks = [_generate_with_semaphore(scene) for scene in scenes]
    await asyncio.gather(*tasks)

    return results


def generate_all_keyframes_sync(
    scenes: list[Scene],
    output_dir: str,
    reference_images: Optional[list[str]] = None,
    style_reference: Optional[str] = None,
    style_reference_map: Optional[dict[int, str]] = None,
    config: Optional[PilipiliConfig] = None,
    max_concurrent: int = 3,
    verbose: bool = False,
    characters: Optional[list] = None,
    aspect_ratio: str = "9:16",
    global_style_prompt: str = "",
) -> dict[int, str]:
    """generate_all_keyframes 的同步版本"""
    return asyncio.run(generate_all_keyframes(
        scenes=scenes,
        output_dir=output_dir,
        reference_images=reference_images,
        style_reference=style_reference,
        style_reference_map=style_reference_map,
        config=config,
        max_concurrent=max_concurrent,
        verbose=verbose,
        characters=characters,
        aspect_ratio=aspect_ratio,
        global_style_prompt=global_style_prompt,
    ))


# ============================================================
# 工具函数
# ============================================================

def _detect_mime_type(path: str) -> str:
    """根据文件扩展名检测 MIME 类型"""
    ext = Path(path).suffix.lower()
    mime_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
    return mime_map.get(ext, "image/jpeg")


def _make_safe_prompt(scene: Scene) -> str:
    """
    生成安全版 prompt：去掉人物/肢体接触描述，只保留场景环境。
    用于 IMAGE_SAFETY 拦截后的重试。
    """
    # 提取场景关键词（去掉人物相关词汇）
    unsafe_keywords = [
        "touch", "kiss", "hug", "embrace", "hold", "hand", "body",
        "intimate", "close", "near", "together", "couple",
        "触碰", "接触", "拥抱", "亲吻", "靠近", "依偎", "手", "身体",
    ]
    prompt = scene.image_prompt
    for kw in unsafe_keywords:
        prompt = prompt.replace(kw, "")

    # 构建纯场景描述
    safe = (
        f"A beautiful cinematic scene: {prompt[:200]}. "
        f"No people, focus on environment and atmosphere. "
        f"Ultra high quality, 1080P resolution, cinematic composition."
    )
    return safe


def _create_placeholder_image(output_path: str, scene_id: int, verbose: bool = False, aspect_ratio: str = "9:16") -> None:
    """
    生成纯色占位图（深灰色，带场景编号文字）。
    用于所有模型均无法生成图片时的兆底，让流程继续运行。
    """
    if aspect_ratio in ("9:16", "3:4"):
        width, height = 720, 1280  # 竖屏
    else:
        width, height = 1920, 1080  # 横屏
    if _PIL_AVAILABLE:
        img = Image.new("RGB", (width, height), color=(30, 30, 40))
        draw = ImageDraw.Draw(img)
        text = f"Scene {scene_id}"
        # 简单居中文字
        try:
            bbox = draw.textbbox((0, 0), text)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
        except Exception:
            tw, th = 100, 30
        draw.text(
            ((width - tw) // 2, (height - th) // 2),
            text,
            fill=(120, 120, 130),
        )
        img.save(output_path, "PNG")
    else:
        # PIL 不可用时写一个最小合法 PNG（1x1 黑色像素）
        import struct, zlib
        def _png_chunk(tag, data):
            c = zlib.crc32(tag + data) & 0xFFFFFFFF
            return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", c)
        png = (
            b"\x89PNG\r\n\x1a\n"
            + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + _png_chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00"))
            + _png_chunk(b"IEND", b"")
        )
        with open(output_path, "wb") as f:
            f.write(png)
    if verbose:
        print(f"[ImageGen] Scene {scene_id} 占位图已创建: {output_path}")
