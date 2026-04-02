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

import {
  createProjectSocket,
  deleteProject,
  getDownloadDraftUrl,
  getDownloadVideoUrl,
  getProject,
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
    label: `Scene ${scene.scene_id} · ${scene.duration}s`,
    children: (
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Space.Compact style={{ width: "100%" }}>
          <Button disabled style={{ width: 88 }}>
            旁白
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
          placeholder="image prompt"
        />
        <Input.TextArea
          rows={3}
          value={scene.video_prompt}
          onChange={(event) => {
            const next = [...reviewScenes];
            next[index] = { ...scene, video_prompt: event.target.value };
            setReviewScenes(next);
          }}
          placeholder="video prompt"
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
      messageApi.error((error as Error).message);
    } finally {
      setBusyAction(undefined);
    }
  }

  const artifactStats = [
    { label: "脚本", value: artifacts?.has_script ? "已生成" : "未生成" },
    { label: "关键帧", value: artifacts?.keyframes.length || 0 },
    { label: "配音", value: artifacts?.audio.length || 0 },
    { label: "视频片段", value: artifacts?.clips.length || 0 },
    { label: "字幕", value: artifacts?.subtitles.length || 0 }
  ];

  async function handleSaveTitle() {
    const nextTitle = draftTitle.trim();
    if (!nextTitle) {
      messageApi.warning("标题不能为空");
      return;
    }
    setBusyAction("update_title");
    try {
      await updateProjectTitle(projectId, nextTitle);
      messageApi.success("标题已更新");
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
      messageApi.success("项目已删除");
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
                <Button icon={<ArrowLeftOutlined />}>返回工作台</Button>
              </Link>
            ) : null}
            <Tag color="blue">{projectId}</Tag>
            <Tag color="cyan">{stageLabel[project?.status?.stage || "idle"]}</Tag>
            {embedded ? (
              <Link href={`/projects/${projectId}`}>
                <Button icon={<EyeOutlined />}>独立查看</Button>
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
                    保存标题
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingTitle(false);
                      setDraftTitle(scriptTitle);
                    }}
                  >
                    取消
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
                  修改标题
                </Button>
              )
            ) : null}
          </Space>
          <Typography.Paragraph type="secondary">
            服务端会返回当前可执行动作。页面不再猜“能否恢复”，而是直接显示下一步。
          </Typography.Paragraph>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void loadProject()}>
            刷新
          </Button>
          {isCompleted ? (
            <>
              <Button icon={<DownloadOutlined />} href={getDownloadVideoUrl(projectId)} target="_blank">
                下载视频
              </Button>
              <Button href={getDownloadDraftUrl(projectId)} target="_blank">
                下载草稿
              </Button>
            </>
          ) : null}
          {(project?.status?.stage === "completed" || project?.status?.stage === "failed" || project?.status?.stage === "idle") ? (
            <Popconfirm
              title="删除这个项目？"
              description="会同时删除本地产物和项目记录，无法恢复。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true, loading: busyAction === "delete_project" }}
              onConfirm={() => void handleDeleteProject()}
            >
              <Button danger icon={<DeleteOutlined />}>
                删除项目
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      </div>

      <Card className="lingti-card" loading={loading}>
        <Space direction="vertical" size={18} style={{ width: "100%" }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            流程进度
          </Typography.Title>
          {project?.status?.error ? (
            <Alert
              type="error"
              showIcon
              message="执行失败"
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
            items={workflowSteps.map((item) => ({ title: item.title }))}
          />
        </Space>
      </Card>

      <Row gutter={[24, 24]}>
        <Col xs={24} xl={9}>
          <Space direction="vertical" size={24} style={{ width: "100%" }}>
            <Card className="lingti-card" loading={loading} title="任务状态">
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="阶段">
                  {stageLabel[project?.status?.stage || "idle"]}
                </Descriptions.Item>
                <Descriptions.Item label="进度">
                  {project?.status?.progress ?? 0}%
                </Descriptions.Item>
                <Descriptions.Item label="消息">
                  {project?.status?.message || "-"}
                </Descriptions.Item>
                <Descriptions.Item label="当前分镜">
                  {project?.status?.current_scene && project?.status?.total_scenes
                    ? `${project.status.current_scene} / ${project.status.total_scenes}`
                    : "-"}
                </Descriptions.Item>
                <Descriptions.Item label="创建时间">
                  {project?.created_at ? new Date(project.created_at).toLocaleString("zh-CN") : "-"}
                </Descriptions.Item>
                <Descriptions.Item label="旁白音色">
                  {project?.voice_id || "-"}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card className="lingti-card" loading={loading} title="实时控制台">
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
                  message="还没有日志输出"
                  description="工作流启动后，这里会实时显示后端生成过程中的命令行输出。"
                />
              )}
            </Card>

            <Card className="lingti-card" loading={loading} title="产物概览">
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
            <Card className="lingti-card" loading={loading} title="脚本审核台">
              <Space direction="vertical" size={18} style={{ width: "100%" }}>
                <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                  如果项目进入审核阶段，可以直接改旁白、图像提示词和视频提示词，再一键继续。
                </Typography.Paragraph>
                {reviewScenes.length ? (
                  <Collapse accordion={false} items={reviewItems} />
                ) : (
                  <Empty description="还没有可审核的分镜" />
                )}
                {isAwaitingReview ? (
                  <Space wrap>
                    <Button
                      type="primary"
                      icon={<SendOutlined />}
                      loading={busyAction === "approve_review"}
                      onClick={() => void handleAction("approve_review")}
                    >
                      审核通过并继续
                    </Button>
                    <Button
                      danger
                      loading={busyAction === "reject_review"}
                      onClick={() => void handleAction("reject_review")}
                    >
                      驳回项目
                    </Button>
                  </Space>
                ) : (
                  <Alert
                    type="info"
                    showIcon
                    message="当前项目不在人工审核阶段"
                    description="如果后端进入 awaiting_review，这里会自动切成可提交状态。"
                  />
                )}
              </Space>
            </Card>

            <Card className="lingti-card" loading={loading} title="输出与资产">
              {isCompleted && project?.result?.final_video ? (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <video
                    controls
                    preload="metadata"
                    src={getDownloadVideoUrl(projectId)}
                    style={{ width: "100%", borderRadius: 18, background: "#110808" }}
                  />
                  <Descriptions column={1} size="small" bordered>
                    <Descriptions.Item label="视频文件">
                      {project.result.final_video}
                    </Descriptions.Item>
                    <Descriptions.Item label="字幕文件">
                      {artifacts?.subtitles[0] || "无"}
                    </Descriptions.Item>
                    <Descriptions.Item label="剪映草稿">
                      {project.result.draft_dir || "-"}
                    </Descriptions.Item>
                    <Descriptions.Item label="总时长">
                      {project.result.total_duration ? `${project.result.total_duration.toFixed(1)}s` : "-"}
                    </Descriptions.Item>
                  </Descriptions>
                </Space>
              ) : artifacts?.has_clips ? (
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="已生成片段">
                    {artifacts.clips.length}
                  </Descriptions.Item>
                  <Descriptions.Item label="最终视频">
                    {artifacts.final_video || "尚未生成"}
                  </Descriptions.Item>
                  <Descriptions.Item label="字幕">
                    {artifacts.subtitles.length ? artifacts.subtitles.join("\n") : "尚未生成"}
                  </Descriptions.Item>
                </Descriptions>
              ) : (
                <Alert
                  type="warning"
                  showIcon
                  message="成片尚未生成"
                  description="生成完成后，这里会直接提供预览、下载视频和下载剪映草稿。"
                />
              )}
            </Card>

            <Card className="lingti-card" loading={loading} title="下一步操作">
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
                  message="当前没有可执行动作"
                  description="进行中的任务会自动继续，已完成任务可直接下载或重新组装。"
                />
              )}
            </Card>
          </Space>
        </Col>
      </Row>
    </Space>
  );
}
