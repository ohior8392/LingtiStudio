"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Empty,
  Input,
  Popconfirm,
  Progress,
  Row,
  Space,
  Steps,
  Tag,
  Typography,
  message
} from "antd";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  DownloadOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined
} from "@ant-design/icons";

import { useLanguage } from "@/components/language-provider";
import {
  createProjectSocket,
  deleteProject,
  getDownloadDraftUrl,
  getDownloadVideoUrl,
  getProject,
  isSetupRequiredError,
  listProjectLogs,
  runProjectAction,
  updateProjectTitle
} from "@/lib/api";
import type {
  ProjectAction,
  ProjectLog,
  ProjectRecord,
  ProjectResult,
  ProjectStatus,
  SceneDraft,
  ScriptDraft
} from "@/lib/types";

const stageLabel: Record<string, string> = {
  idle: "待处理",
  generating_script: "脚本生成",
  awaiting_review: "等待审核",
  generating_images: "关键帧生成",
  generating_audio: "配音生成",
  generating_video: "视频生成",
  assembling: "视频组装",
  completed: "已完成",
  failed: "失败"
};

const workflowSteps = [
  { key: "generating_script", title: "脚本" },
  { key: "awaiting_review", title: "审核" },
  { key: "generating_images", title: "关键帧" },
  { key: "generating_audio", title: "配音" },
  { key: "generating_video", title: "视频" },
  { key: "assembling", title: "组装" },
  { key: "completed", title: "完成" }
];

function mergeProjectRecord(project: ProjectRecord, status: ProjectStatus): ProjectRecord {
  const nextScript = status.script ? (status.script as ScriptDraft) : project.script;
  const nextResult = status.result
    ? { ...(project.result || {}), ...(status.result as ProjectResult) }
    : project.result;

  return {
    ...project,
    status: {
      ...project.status,
      ...status
    },
    script: nextScript,
    result: nextResult
  };
}

function getCurrentStep(stage?: string) {
  if (!stage || stage === "idle") {
    return 0;
  }
  if (stage === "failed") {
    return Math.max(workflowSteps.length - 2, 0);
  }
  const index = workflowSteps.findIndex((step) => step.key === stage);
  return index >= 0 ? index : 0;
}

export function ProjectDetailClient({
  projectId,
  embedded = false,
  onDeleted
}: {
  projectId: string;
  embedded?: boolean;
  onDeleted?: (projectId: string) => void;
}) {
  const { isZh } = useLanguage();
  const router = useRouter();
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [reviewScenes, setReviewScenes] = useState<SceneDraft[]>([]);
  const [logs, setLogs] = useState<ProjectLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string>();
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [messageApi, contextHolder] = message.useMessage();
  const socketRef = useRef<WebSocket | null>(null);

  async function loadProject() {
    setLoading(true);
    try {
      const [data, projectLogs] = await Promise.all([
        getProject(projectId),
        listProjectLogs(projectId).catch(() => [])
      ]);
      setProject(data);
      setReviewScenes(data.script?.scenes || data.result?.script?.scenes || []);
      setLogs(projectLogs);
    } catch (error) {
      messageApi.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProject();
  }, [projectId]);

  useEffect(() => {
    socketRef.current?.close();
    socketRef.current = createProjectSocket(
      projectId,
      (status) => {
        setProject((prev) => {
          if (!prev) {
            return prev;
          }
          const nextProject = mergeProjectRecord(prev, status);
          if (status.script?.scenes) {
            setReviewScenes(status.script.scenes);
          }
          return nextProject;
        });
      },
      (log) => {
        setLogs((prev) => [...prev, log].slice(-500));
      }
    );

    const heartbeat = window.setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send("ping");
      }
    }, 15000);

    return () => {
      window.clearInterval(heartbeat);
      socketRef.current?.close();
    };
  }, [projectId]);

  const scriptTitle = useMemo(
    () => project?.title || project?.script?.title || project?.result?.script?.title || project?.topic || projectId,
    [project, projectId]
  );
  const actions = project?.actions || [];
  const isCompleted = project?.status?.stage === "completed";
  const isAwaitingReview = project?.status?.stage === "awaiting_review";
  const artifacts = project?.artifacts;

  useEffect(() => {
    if (scriptTitle) {
      setDraftTitle(scriptTitle);
    }
  }, [scriptTitle]);

  const reviewItems = reviewScenes.map((scene, index) => ({
    key: String(scene.scene_id),
    label: `${isZh ? "分镜" : "Scene"} ${scene.scene_id} · ${scene.duration}s`,
    children: (
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Space.Compact style={{ width: "100%" }}>
          <Button disabled style={{ width: 88 }}>
            {isZh ? "旁白" : "Voice"}
          </Button>
          <Input
            value={scene.voiceover}
            onChange={(event) => {
              const next = [...reviewScenes];
              next[index] = { ...scene, voiceover: event.target.value };
              setReviewScenes(next);
            }}
          />
        </Space.Compact>
        <Input.TextArea
          rows={4}
          value={scene.image_prompt}
          onChange={(event) => {
            const next = [...reviewScenes];
            next[index] = { ...scene, image_prompt: event.target.value };
            setReviewScenes(next);
          }}
          placeholder={isZh ? "图像提示词" : "Image prompt"}
        />
        <Input.TextArea
          rows={3}
          value={scene.video_prompt}
          onChange={(event) => {
            const next = [...reviewScenes];
            next[index] = { ...scene, video_prompt: event.target.value };
            setReviewScenes(next);
          }}
          placeholder={isZh ? "视频提示词" : "Video prompt"}
        />
      </Space>
    )
  }));

  async function handleAction(action: ProjectAction["key"]) {
    setBusyAction(action);
    try {
      await runProjectAction(projectId, action, {
        scenes: action === "approve_review" ? reviewScenes : undefined,
        video_engine: "kling",
        add_subtitles: true
      });
      messageApi.success("操作已提交");
      await loadProject();
    } catch (error) {
      if (isSetupRequiredError(error)) {
        messageApi.warning(isZh ? "当前配置不完整，已经为你打开 Setup 配置窗口。" : "Configuration is incomplete. The Setup dialog has been opened for you.");
      } else {
        messageApi.error((error as Error).message);
      }
    } finally {
      setBusyAction(undefined);
    }
  }

  const artifactStats = [
    { label: isZh ? "脚本" : "Script", value: artifacts?.has_script ? (isZh ? "已生成" : "Ready") : (isZh ? "未生成" : "Missing") },
    { label: isZh ? "关键帧" : "Keyframes", value: artifacts?.keyframes.length || 0 },
    { label: isZh ? "配音" : "Voiceover", value: artifacts?.audio.length || 0 },
    { label: isZh ? "视频片段" : "Video clips", value: artifacts?.clips.length || 0 },
    { label: isZh ? "字幕" : "Subtitles", value: artifacts?.subtitles.length || 0 }
  ];

  async function handleSaveTitle() {
    const nextTitle = draftTitle.trim();
    if (!nextTitle) {
      messageApi.warning(isZh ? "标题不能为空" : "Title cannot be empty");
      return;
    }
    setBusyAction("update_title");
    try {
      await updateProjectTitle(projectId, nextTitle);
      messageApi.success(isZh ? "标题已更新" : "Title updated");
      setEditingTitle(false);
      await loadProject();
    } catch (error) {
      messageApi.error((error as Error).message);
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleDeleteProject() {
    setBusyAction("delete_project");
    try {
      await deleteProject(projectId);
      messageApi.success(isZh ? "项目已删除" : "Project deleted");
      onDeleted?.(projectId);
      if (!embedded) {
        router.push("/studio");
      }
    } catch (error) {
      messageApi.error((error as Error).message);
    } finally {
      setBusyAction(undefined);
    }
  }

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      {contextHolder}
      <div className="workspace-header" style={{ marginBottom: embedded ? 0 : 24 }}>
        <div className="workspace-title">
          <Space wrap>
            {!embedded ? (
              <Link href="/studio">
                <Button icon={<ArrowLeftOutlined />}>{isZh ? "返回工作台" : "Back to Studio"}</Button>
              </Link>
            ) : null}
            <Tag color="blue">{projectId}</Tag>
            <Tag color="cyan">{isZh ? stageLabel[project?.status?.stage || "idle"] : ({
              idle: "Idle",
              generating_script: "Script",
              awaiting_review: "Review",
              generating_images: "Keyframes",
              generating_audio: "Voiceover",
              generating_video: "Video",
              assembling: "Assembly",
              completed: "Completed",
              failed: "Failed",
            }[project?.status?.stage || "idle"])}</Tag>
            {embedded ? (
              <Link href={`/projects/${projectId}`}>
                <Button icon={<EyeOutlined />}>{isZh ? "独立查看" : "Open page"}</Button>
              </Link>
            ) : null}
          </Space>
          <Space align="center" wrap>
            <Typography.Title level={embedded ? 3 : 2} style={{ margin: 0 }}>
              {editingTitle ? (
                <Input
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  style={{ minWidth: 320 }}
                  maxLength={120}
                  autoFocus
                />
              ) : (
                scriptTitle
              )}
            </Typography.Title>
            {!isCompleted ? (
              editingTitle ? (
                <Space>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    size="small"
                    loading={busyAction === "update_title"}
                    onClick={() => void handleSaveTitle()}
                  >
                    {isZh ? "保存标题" : "Save title"}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingTitle(false);
                      setDraftTitle(scriptTitle);
                    }}
                  >
                    {isZh ? "取消" : "Cancel"}
                  </Button>
                </Space>
              ) : (
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setDraftTitle(scriptTitle);
                    setEditingTitle(true);
                  }}
                >
                  {isZh ? "修改标题" : "Edit title"}
                </Button>
              )
            ) : null}
          </Space>
          <Typography.Paragraph type="secondary">
            {isZh
              ? "服务端会返回当前可执行动作。页面不再猜“能否恢复”，而是直接显示下一步。"
              : "The server returns the available actions. The UI no longer guesses whether recovery is possible."}
          </Typography.Paragraph>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void loadProject()}>
            {isZh ? "刷新" : "Refresh"}
          </Button>
          {isCompleted ? (
            <>
              <Button icon={<DownloadOutlined />} href={getDownloadVideoUrl(projectId)} target="_blank">
                {isZh ? "下载视频" : "Download video"}
              </Button>
              <Button href={getDownloadDraftUrl(projectId)} target="_blank">
                {isZh ? "下载草稿" : "Download draft"}
              </Button>
            </>
          ) : null}
          {(project?.status?.stage === "completed" || project?.status?.stage === "failed" || project?.status?.stage === "idle") ? (
            <Popconfirm
              title={isZh ? "删除这个项目？" : "Delete this project?"}
              description={isZh ? "会同时删除本地产物和项目记录，无法恢复。" : "This will permanently remove local artifacts and project records."}
              okText={isZh ? "删除" : "Delete"}
              cancelText={isZh ? "取消" : "Cancel"}
              okButtonProps={{ danger: true, loading: busyAction === "delete_project" }}
              onConfirm={() => void handleDeleteProject()}
            >
              <Button danger icon={<DeleteOutlined />}>
                {isZh ? "删除项目" : "Delete project"}
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      </div>

      <Card className="lingti-card" loading={loading}>
        <Space direction="vertical" size={18} style={{ width: "100%" }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {isZh ? "流程进度" : "Workflow Progress"}
          </Typography.Title>
          {project?.status?.error ? (
            <Alert
              type="error"
              showIcon
              message={isZh ? "执行失败" : "Execution failed"}
              description={project.status.error}
            />
          ) : null}
          <Progress
            percent={project?.status?.progress || 0}
            status={project?.status?.stage === "failed" ? "exception" : isCompleted ? "success" : "active"}
          />
          <Steps
            current={getCurrentStep(project?.status?.stage)}
            status={project?.status?.stage === "failed" ? "error" : "process"}
            responsive
            items={workflowSteps.map((item) => ({ title: isZh ? item.title : ({
              generating_script: "Script",
              awaiting_review: "Review",
              generating_images: "Keyframes",
              generating_audio: "Voice",
              generating_video: "Video",
              assembling: "Assembly",
              completed: "Done",
            }[item.key]) }))}
          />
        </Space>
      </Card>

      <Row gutter={[24, 24]}>
        <Col xs={24} xl={9}>
          <Space direction="vertical" size={24} style={{ width: "100%" }}>
            <Card className="lingti-card" loading={loading} title={isZh ? "任务状态" : "Project Status"}>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label={isZh ? "阶段" : "Stage"}>
                  {isZh ? stageLabel[project?.status?.stage || "idle"] : ({
                    idle: "Idle",
                    generating_script: "Generating script",
                    awaiting_review: "Awaiting review",
                    generating_images: "Generating keyframes",
                    generating_audio: "Generating voiceover",
                    generating_video: "Generating video",
                    assembling: "Assembling",
                    completed: "Completed",
                    failed: "Failed",
                  }[project?.status?.stage || "idle"])}
                </Descriptions.Item>
                <Descriptions.Item label={isZh ? "进度" : "Progress"}>
                  {project?.status?.progress ?? 0}%
                </Descriptions.Item>
                <Descriptions.Item label={isZh ? "消息" : "Message"}>
                  {project?.status?.message || "-"}
                </Descriptions.Item>
                <Descriptions.Item label={isZh ? "当前分镜" : "Current scene"}>
                  {project?.status?.current_scene && project?.status?.total_scenes
                    ? `${project.status.current_scene} / ${project.status.total_scenes}`
                    : "-"}
                </Descriptions.Item>
                <Descriptions.Item label={isZh ? "创建时间" : "Created at"}>
                  {project?.created_at ? new Date(project.created_at).toLocaleString("zh-CN") : "-"}
                </Descriptions.Item>
                <Descriptions.Item label={isZh ? "旁白音色" : "Voice"}>
                  {project?.voice_id || "-"}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card className="lingti-card" loading={loading} title={isZh ? "实时控制台" : "Live Console"}>
              {logs.length ? (
                <div className="log-console">
                  {logs.map((log, index) => (
                    <div key={`${log.timestamp}-${index}`} className="log-line">
                      <span className="log-time">
                        {new Date(log.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}
                      </span>
                      <span>{log.message}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  message={isZh ? "还没有日志输出" : "No logs yet"}
                  description={isZh ? "工作流启动后，这里会实时显示后端生成过程中的命令行输出。" : "Console output from the backend workflow will appear here in real time."}
                />
              )}
            </Card>

            <Card className="lingti-card" loading={loading} title={isZh ? "产物概览" : "Artifacts Overview"}>
              <Descriptions column={1} size="small" bordered>
                {artifactStats.map((item) => (
                  <Descriptions.Item key={item.label} label={item.label}>
                    {item.value}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </Card>
          </Space>
        </Col>

        <Col xs={24} xl={15}>
          <Space direction="vertical" size={24} style={{ width: "100%" }}>
            <Card className="lingti-card" loading={loading} title={isZh ? "脚本审核台" : "Script Review"}>
              <Space direction="vertical" size={18} style={{ width: "100%" }}>
                <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                  {isZh ? "如果项目进入审核阶段，可以直接改旁白、图像提示词和视频提示词，再一键继续。" : "When the project enters review, edit narration, image prompts, and video prompts here before continuing."}
                </Typography.Paragraph>
                {reviewScenes.length ? (
                  <Collapse accordion={false} items={reviewItems} />
                ) : (
                  <Empty description={isZh ? "还没有可审核的分镜" : "No reviewable scenes yet"} />
                )}
                {isAwaitingReview ? (
                  <Space wrap>
                    <Button
                      type="primary"
                      icon={<SendOutlined />}
                      loading={busyAction === "approve_review"}
                      onClick={() => void handleAction("approve_review")}
                    >
                      {isZh ? "审核通过并继续" : "Approve and continue"}
                    </Button>
                    <Button
                      danger
                      loading={busyAction === "reject_review"}
                      onClick={() => void handleAction("reject_review")}
                    >
                      {isZh ? "驳回项目" : "Reject project"}
                    </Button>
                  </Space>
                ) : (
                  <Alert
                    type="info"
                    showIcon
                    message={isZh ? "当前项目不在人工审核阶段" : "This project is not in manual review"}
                    description={isZh ? "如果后端进入 awaiting_review，这里会自动切成可提交状态。" : "If the backend enters awaiting_review, this panel will switch into submit mode automatically."}
                  />
                )}
              </Space>
            </Card>

            <Card className="lingti-card" loading={loading} title={isZh ? "输出与资产" : "Output and Assets"}>
              {isCompleted && project?.result?.final_video ? (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <video
                    controls
                    preload="metadata"
                    src={getDownloadVideoUrl(projectId)}
                    style={{ width: "100%", borderRadius: 18, background: "#110808" }}
                  />
                  <Descriptions column={1} size="small" bordered>
                    <Descriptions.Item label={isZh ? "视频文件" : "Video file"}>
                      {project.result.final_video}
                    </Descriptions.Item>
                    <Descriptions.Item label={isZh ? "字幕文件" : "Subtitle file"}>
                      {artifacts?.subtitles[0] || (isZh ? "无" : "None")}
                    </Descriptions.Item>
                    <Descriptions.Item label={isZh ? "剪映草稿" : "JianYing draft"}>
                      {project.result.draft_dir || "-"}
                    </Descriptions.Item>
                    <Descriptions.Item label={isZh ? "总时长" : "Total duration"}>
                      {project.result.total_duration ? `${project.result.total_duration.toFixed(1)}s` : "-"}
                    </Descriptions.Item>
                  </Descriptions>
                </Space>
              ) : artifacts?.has_clips ? (
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label={isZh ? "已生成片段" : "Generated clips"}>
                    {artifacts.clips.length}
                  </Descriptions.Item>
                  <Descriptions.Item label={isZh ? "最终视频" : "Final video"}>
                    {artifacts.final_video || (isZh ? "尚未生成" : "Not generated yet")}
                  </Descriptions.Item>
                  <Descriptions.Item label={isZh ? "字幕" : "Subtitles"}>
                    {artifacts.subtitles.length ? artifacts.subtitles.join("\n") : (isZh ? "尚未生成" : "Not generated yet")}
                  </Descriptions.Item>
                </Descriptions>
              ) : (
                <Alert
                  type="warning"
                  showIcon
                  message={isZh ? "成片尚未生成" : "Final video not ready yet"}
                  description={isZh ? "生成完成后，这里会直接提供预览、下载视频和下载剪映草稿。" : "Once generation is complete, this section will provide preview, video download, and JianYing draft download."}
                />
              )}
            </Card>

            <Card className="lingti-card" loading={loading} title={isZh ? "下一步操作" : "Next Actions"}>
              {actions.length ? (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {actions.map((action) => (
                    <Button
                      key={action.key}
                      type={action.kind === "primary" ? "primary" : "default"}
                      danger={action.kind === "danger"}
                      icon={<PlayCircleOutlined />}
                      loading={busyAction === action.key}
                      onClick={() => void handleAction(action.key)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </Space>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  message={isZh ? "当前没有可执行动作" : "No available actions"}
                  description={isZh ? "进行中的任务会自动继续，已完成任务可直接下载或重新组装。" : "Running tasks continue automatically. Completed tasks can be downloaded or reassembled directly."}
                />
              )}
            </Card>
          </Space>
        </Col>
      </Row>
    </Space>
  );
}
