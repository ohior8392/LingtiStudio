import type {
  AssetPack,
  AnalysisTask,
  ConnectorStatus,
  CreateProjectPayload,
  KeysStatus,
  ProjectAction,
  ProjectLog,
  ProjectRecord,
  ProjectStatus,
  SceneDraft,
  SystemHealth,
  SystemSetup,
  VoiceCatalogResponse,
  VoicePreviewResponse,
} from "@/lib/types";

export class ApiError extends Error {
  code?: string;
  setup?: SystemSetup;
  detail?: unknown;

  constructor(message: string, options?: { code?: string; setup?: SystemSetup; detail?: unknown }) {
    super(message);
    this.name = "ApiError";
    this.code = options?.code;
    this.setup = options?.setup;
    this.detail = options?.detail;
  }
}

export function isSetupRequiredError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === "setup_required";
}

export function openSetupOnboarding(setup?: SystemSetup | null) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent("lingti:open-setup", { detail: setup ?? null }));
}

function getDefaultApiBase() {
  if (typeof window === "undefined") {
    return "http://127.0.0.1:8000";
  }
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${window.location.hostname}:8000`;
}

function getDefaultWsBase() {
  if (typeof window === "undefined") {
    return "ws://127.0.0.1:8000";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:8000`;
}

export function getApiBase() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || getDefaultApiBase();
  return apiBase.replace(/\/$/, "");
}

export function getWsBase() {
  const wsBase = process.env.NEXT_PUBLIC_WS_URL || getDefaultWsBase();
  return wsBase.replace(/\/$/, "");
}

export function resolveApiAssetUrl(url: string) {
  if (!url) {
    return url;
  }
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (url.startsWith("/")) {
    return `${getApiBase()}${url}`;
  }
  return `${getApiBase()}/${url.replace(/^\//, "")}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    let message = response.statusText;
    let code: string | undefined;
    let setup: SystemSetup | undefined;
    let detailPayload: unknown;
    try {
      const data = await response.json();
      detailPayload = data?.detail ?? data;
      if (typeof detailPayload === "string") {
        message = detailPayload;
      } else if (detailPayload && typeof detailPayload === "object") {
        const detailRecord = detailPayload as Record<string, unknown>;
        message = String(detailRecord.message || data.message || response.statusText);
        code = typeof detailRecord.code === "string" ? detailRecord.code : undefined;
        setup = detailRecord.setup as SystemSetup | undefined;
      } else {
        message = data.message || JSON.stringify(data);
      }
    } catch {
      message = await response.text();
    }
    if (code === "setup_required") {
      openSetupOnboarding(setup);
    }
    throw new ApiError(message || `HTTP ${response.status}`, {
      code,
      setup,
      detail: detailPayload,
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function getSystemHealth() {
  return request<SystemHealth>("/api/system/health");
}

export function getConnectorStatus() {
  return request<ConnectorStatus>("/api/system/connectors");
}

export function getSystemSetup() {
  return request<SystemSetup>("/api/system/setup");
}

export function listProjects() {
  return request<ProjectRecord[]>("/api/projects");
}

export function getProject(projectId: string) {
  return request<ProjectRecord>(`/api/projects/${projectId}`);
}

export function updateProjectTitle(projectId: string, title: string) {
  return request<{ project_id: string; message: string; title: string }>(`/api/projects/${projectId}/title`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
}

export function deleteProject(projectId: string) {
  return request<{ project_id: string; message: string }>(`/api/projects/${projectId}`, {
    method: "DELETE"
  });
}

export function getProjectArtifacts(projectId: string) {
  return request<ProjectRecord["artifacts"]>(`/api/projects/${projectId}/artifacts`);
}

export function listProjectLogs(projectId: string, limit = 200) {
  return request<ProjectLog[]>(`/api/projects/${projectId}/logs?limit=${limit}`);
}

export function createProject(payload: CreateProjectPayload) {
  return request<{ project_id: string; message: string }>("/api/projects", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listTtsVoices(params?: { source?: "system" | "all"; q?: string; language?: string }) {
  const search = new URLSearchParams();
  if (params?.source) {
    search.set("source", params.source);
  }
  if (params?.q) {
    search.set("q", params.q);
  }
  if (params?.language) {
    search.set("language", params.language);
  }
  const query = search.toString();
  return request<VoiceCatalogResponse>(`/api/tts/voices${query ? `?${query}` : ""}`);
}

export async function previewTtsVoice(voiceId: string) {
  const result = await request<VoicePreviewResponse>("/api/tts/preview", {
    method: "POST",
    body: JSON.stringify({ voice_id: voiceId })
  });
  return {
    ...result,
    audio_url: resolveApiAssetUrl(result.audio_url)
  };
}

export function runProjectAction(
  projectId: string,
  action: ProjectAction["key"],
  options?: {
    video_engine?: string;
    add_subtitles?: boolean;
    scenes?: SceneDraft[];
    asset_pack?: AssetPack;
    asset_category?: string;
    asset_id?: string;
  }
) {
  return request<{ project_id: string; message: string }>(`/api/projects/${projectId}/actions`, {
    method: "POST",
    body: JSON.stringify({
      action,
      video_engine: options?.video_engine,
      add_subtitles: options?.add_subtitles ?? true,
      scenes: options?.scenes,
      asset_pack: options?.asset_pack,
      asset_category: options?.asset_category,
      asset_id: options?.asset_id,
    })
  });
}

export function submitReview(projectId: string, approved: boolean, scenes?: SceneDraft[]) {
  return runProjectAction(projectId, approved ? "approve_review" : "reject_review", {
    scenes
  }).then((result) => ({ ...result, approved }));
}

export function updateScript(projectId: string, scenes: SceneDraft[]) {
  return request<{ message: string }>(`/api/projects/${projectId}/script`, {
    method: "PUT",
    body: JSON.stringify(scenes)
  });
}

export function resumeProject(projectId: string, videoEngine: string, addSubtitles: boolean) {
  return runProjectAction(projectId, "resume_from_video", {
    video_engine: videoEngine,
    add_subtitles: addSubtitles
  });
}

export function resumeProjectFromScript(projectId: string, videoEngine: string, addSubtitles: boolean) {
  return runProjectAction(projectId, "resume_from_script", {
    video_engine: videoEngine,
    add_subtitles: addSubtitles
  });
}

export function reassembleProject(projectId: string, addSubtitles: boolean) {
  return runProjectAction(projectId, "reassemble", {
    add_subtitles: addSubtitles
  });
}

export function getKeysStatus() {
  return request<KeysStatus>("/api/settings/keys/status");
}

export function updateApiKeys(payload: Record<string, string>) {
  return request<{ message: string; updated_keys: string[] }>("/api/settings/keys", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function testKey(service: string) {
  return request<{ success: boolean; message: string }>("/api/settings/keys/test", {
    method: "POST",
    body: JSON.stringify({ service })
  });
}

export async function uploadReference(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${getApiBase()}/api/upload/reference`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {
      detail = await response.text();
    }
    throw new Error(detail);
  }

  return response.json() as Promise<{
    path: string;
    filename: string;
    type: string;
    message: string;
  }>;
}

export async function uploadAnalysisVideo(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${getApiBase()}/api/analyze/upload`, {
    method: "POST",
    body: formData
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {
      detail = await response.text();
    }
    throw new Error(detail);
  }
  return response.json() as Promise<{ analysis_id: string; status: string; message: string }>;
}

export function getAnalysisTask(analysisId: string) {
  return request<AnalysisTask>(`/api/analyze/${analysisId}`);
}

export async function replaceAnalysisCharacter(analysisId: string, characterId: number, file: File) {
  const formData = new FormData();
  formData.append("character_id", String(characterId));
  formData.append("file", file);
  const response = await fetch(`${getApiBase()}/api/analyze/${analysisId}/replace-character`, {
    method: "POST",
    body: formData
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {
      detail = await response.text();
    }
    throw new Error(detail);
  }
  return response.json() as Promise<{
    message: string;
    character_id: number;
    replacement_image: string;
    path: string;
  }>;
}

export function removeAnalysisCharacter(analysisId: string, characterId: number) {
  return request<{ message: string; character_id: number }>(
    `/api/analyze/${analysisId}/remove-character-image?character_id=${characterId}`,
    { method: "DELETE" }
  );
}

export async function createProjectFromAnalysis(
  analysisId: string,
  options?: { topic?: string; video_engine?: string; add_subtitles?: boolean }
) {
  const formData = new FormData();
  if (options?.topic) {
    formData.append("topic", options.topic);
  }
  if (options?.video_engine) {
    formData.append("video_engine", options.video_engine);
  }
  formData.append("add_subtitles", String(options?.add_subtitles ?? true));
  const response = await fetch(`${getApiBase()}/api/analyze/${analysisId}/create-project`, {
    method: "POST",
    body: formData
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {
      detail = await response.text();
    }
    throw new Error(detail);
  }
  return response.json() as Promise<{
    project_id: string;
    message: string;
    reference_images_count: number;
  }>;
}

export function getDownloadVideoUrl(projectId: string, variant: "final" | "plain" | "subtitled" = "final") {
  return `${getApiBase()}/api/projects/${projectId}/download/video?variant=${variant}`;
}

export function getDownloadDraftUrl(projectId: string) {
  return `${getApiBase()}/api/projects/${projectId}/download/draft`;
}

export function createProjectSocket(
  projectId: string,
  onStatus: (status: ProjectStatus) => void,
  onLog?: (log: ProjectLog) => void
) {
  const socket = new WebSocket(`${getWsBase()}/ws/${projectId}`);

  socket.onmessage = (event) => {
    if (event.data === "pong") {
      return;
    }
    try {
      const payload = JSON.parse(event.data) as ProjectStatus | ProjectLog;
      if (payload.type === "log") {
        onLog?.(payload as ProjectLog);
        return;
      }
      onStatus(payload as ProjectStatus);
    } catch {
      // Ignore malformed payloads from heartbeat or server logs.
    }
  };

  return socket;
}
