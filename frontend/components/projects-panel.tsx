"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  List,
  Popconfirm,
  Space,
  Tag,
  Typography
} from "antd";
import {
  DeleteOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  RocketOutlined,
  VideoCameraAddOutlined
} from "@ant-design/icons";
import dayjs from "dayjs";

import { useLanguage } from "@/components/language-provider";
import { deleteProject, listProjects, reassembleProject, resumeProject, resumeProjectFromScript } from "@/lib/api";
import type { ProjectAction, ProjectRecord, WorkflowStage } from "@/lib/types";

const stageColorMap: Record<WorkflowStage, string> = {
  idle: "default",
  generating_script: "processing",
  awaiting_review: "warning",
  generating_assets: "processing",
  awaiting_asset_review: "warning",
  generating_images: "processing",
  generating_audio: "processing",
  generating_video: "processing",
  assembling: "processing",
  completed: "success",
  failed: "error"
};

const stageLabelMap: Record<WorkflowStage, string> = {
  idle: "待处理",
  generating_script: "脚本生成中",
  awaiting_review: "等待审核",
  generating_assets: "资产生成中",
  awaiting_asset_review: "等待资产确认",
  generating_images: "关键帧生成中",
  generating_audio: "配音生成中",
  generating_video: "视频生成中",
  assembling: "组装中",
  completed: "已完成",
  failed: "失败"
};

const groupConfig = [
  { key: "focus", title: "待处理与进行中" },
  { key: "failed", title: "失败待处理" },
  { key: "done", title: "已完成" }
] as const;

interface Props {
  refreshToken?: number;
  selectedProjectId?: string;
  onSelect?: (projectId?: string) => void;
  compact?: boolean;
}

export function ProjectsPanel({
  refreshToken = 0,
  selectedProjectId,
  onSelect,
  compact = false
}: Props) {
  const { isZh } = useLanguage();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [busyKey, setBusyKey] = useState<string>();

  async function fetchProjects() {
    setLoading(true);
    try {
      const result = await listProjects();
      const sorted = [...result].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
      setProjects(sorted);
      setError(undefined);
    } catch (fetchError) {
      setError((fetchError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(projectId: string, action: ProjectAction["key"]) {
    const key = `${projectId}:${action}`;
    setBusyKey(key);
    const project = projects.find((item) => item.id === projectId);
    const videoEngine = project?.workflow_request?.video_engine || "kling";
    const addSubtitles = project?.workflow_request?.add_subtitles ?? true;
    try {
      if (action === "resume_from_script") {
        await resumeProjectFromScript(projectId, videoEngine, addSubtitles);
      } else if (action === "resume_from_video") {
        await resumeProject(projectId, videoEngine, addSubtitles);
      } else if (action === "reassemble") {
        await reassembleProject(projectId, addSubtitles);
      }
      await fetchProjects();
      onSelect?.(projectId);
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusyKey(undefined);
    }
  }

  async function handleDelete(projectId: string) {
    const key = `${projectId}:delete`;
    setBusyKey(key);
    try {
      await deleteProject(projectId);
      await fetchProjects();
      if (selectedProjectId === projectId) {
        onSelect?.(undefined);
      }
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setBusyKey(undefined);
    }
  }

  useEffect(() => {
    void fetchProjects();
  }, [refreshToken]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchProjects();
    }, 12000);
    return () => window.clearInterval(timer);
  }, []);

  const grouped = useMemo(() => {
    const focus: ProjectRecord[] = [];
    const failed: ProjectRecord[] = [];
    const done: ProjectRecord[] = [];

    for (const project of projects) {
      const stage = project.status?.stage || "idle";
      if (stage === "completed") {
        done.push(project);
      } else if (stage === "failed") {
        failed.push(project);
      } else {
        focus.push(project);
      }
    }

    return { focus, failed, done };
  }, [projects]);

  const visibleGroups = groupConfig
    .map((group) => ({
      ...group,
      items: grouped[group.key]
    }))
    .filter((group) => group.items.length > 0 || !compact);

  return (
    <Card
      className="lingti-card"
      title={isZh ? "任务中心" : "Task Center"}
      extra={
        <Space>
          <Tag color="success">{isZh ? `完成 ${grouped.done.length}` : `Done ${grouped.done.length}`}</Tag>
          <Button icon={<ReloadOutlined />} onClick={() => void fetchProjects()}>
            {isZh ? "刷新" : "Refresh"}
          </Button>
        </Space>
      }
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      {!projects.length && !loading ? (
        <Empty description={isZh ? "还没有项目记录" : "No projects yet"} />
      ) : (
        <Space direction="vertical" size={18} style={{ width: "100%" }}>
          {visibleGroups.map((group) => (
            <div key={group.key}>
              <Typography.Title level={5} style={{ marginBottom: 12 }}>
                {group.key === "focus"
                  ? isZh ? "待处理与进行中" : "Active and pending"
                  : group.key === "failed"
                    ? isZh ? "失败待处理" : "Failed and waiting"
                    : isZh ? "已完成" : "Completed"}
              </Typography.Title>
              {group.items.length ? (
                <List
                  loading={loading}
                  dataSource={compact ? group.items.slice(0, 4) : group.items}
                  renderItem={(project) => {
                    const primaryAction = (project.actions || []).find((item) =>
                      ["resume_from_script", "resume_from_video", "reassemble"].includes(item.key)
                    );
                    return (
                      <List.Item
                        className={`project-list-item ${selectedProjectId === project.id ? "project-list-item-active" : ""}`}
                        style={{ cursor: onSelect ? "pointer" : "default" }}
                        onClick={() => onSelect?.(project.id)}
                        actions={[
                          primaryAction ? (
                            <Button
                              key={primaryAction.key}
                              size="small"
                              type={primaryAction.kind === "primary" ? "primary" : "default"}
                              icon={primaryAction.key === "reassemble" ? <VideoCameraAddOutlined /> : <RocketOutlined />}
                              loading={busyKey === `${project.id}:${primaryAction.key}`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void handleAction(project.id, primaryAction.key);
                              }}
                            >
                              {primaryAction.label}
                            </Button>
                          ) : null,
                          project.status?.stage === "completed" || project.status?.stage === "failed" ? (
                            <Popconfirm
                              key="delete"
                              title={isZh ? "删除这个项目？" : "Delete this project?"}
                              description={isZh ? "会同时删除本地产物和项目记录，无法恢复。" : "This will permanently remove local artifacts and project records."}
                              okText={isZh ? "删除" : "Delete"}
                              cancelText={isZh ? "取消" : "Cancel"}
                              okButtonProps={{ danger: true, loading: busyKey === `${project.id}:delete` }}
                              onConfirm={() => void handleDelete(project.id)}
                            >
                              <Button
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                              >
                                {isZh ? "删除" : "Delete"}
                              </Button>
                            </Popconfirm>
                          ) : null,
                          <Link key="detail" href={`/projects/${project.id}`}>
                            {isZh ? "查看详情" : "View details"}
                          </Link>
                        ].filter(Boolean)}
                      >
                        <List.Item.Meta
                          avatar={<FolderOpenOutlined style={{ fontSize: 18, color: "#60a5fa" }} />}
                          title={
                            <Space wrap>
                              <Typography.Text strong>{project.title || project.script?.title || project.topic || project.id}</Typography.Text>
                              <Tag color={stageColorMap[project.status?.stage || "idle"]}>
                                {(isZh
                                  ? stageLabelMap[project.status?.stage || "idle"]
                                  : {
                                      idle: "Idle",
                                      generating_script: "Generating script",
                                      awaiting_review: "Awaiting review",
                                      generating_assets: "Generating assets",
                                      awaiting_asset_review: "Awaiting asset review",
                                      generating_images: "Generating keyframes",
                                      generating_audio: "Generating voiceover",
                                      generating_video: "Generating video",
                                      assembling: "Assembling",
                                      completed: "Completed",
                                      failed: "Failed",
                                    }[project.status?.stage || "idle"])}
                              </Tag>
                              {selectedProjectId === project.id ? <Tag color="blue">{isZh ? "当前查看" : "Selected"}</Tag> : null}
                              {project.artifacts?.has_result ? <Tag color="green">{isZh ? "已有成片" : "Has final video"}</Tag> : null}
                              {project.actions?.length ? <Tag color="orange">{isZh ? `待操作 ${project.actions.length}` : `Actions ${project.actions.length}`}</Tag> : null}
                            </Space>
                          }
                          description={
                            <Space direction="vertical" size={4}>
                              <Typography.Text type="secondary">
                                {project.status?.message || (isZh ? "等待状态回传" : "Waiting for status updates")}
                              </Typography.Text>
                              <Typography.Text type="secondary">
                                {dayjs(project.created_at).format("YYYY-MM-DD HH:mm:ss")} · {project.status?.progress ?? 0}%
                              </Typography.Text>
                            </Space>
                          }
                        />
                      </List.Item>
                    );
                  }}
                />
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    isZh
                      ? `暂无${group.key === "focus" ? "待处理与进行中项目" : group.key === "failed" ? "失败项目" : "已完成项目"}`
                      : `No ${group.key === "focus" ? "active projects" : group.key === "failed" ? "failed projects" : "completed projects"}`
                  }
                />
              )}
            </div>
          ))}
        </Space>
      )}
    </Card>
  );
}
