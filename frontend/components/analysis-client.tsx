"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Form,
  Input,
  Row,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
  message
} from "antd";
import {
  InboxOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SwapOutlined,
  UploadOutlined
} from "@ant-design/icons";

import {
  createProjectFromAnalysis,
  getAnalysisTask,
  removeAnalysisCharacter,
  replaceAnalysisCharacter,
  uploadAnalysisVideo
} from "@/lib/api";
import type { AnalysisTask } from "@/lib/types";

export function AnalysisClient() {
  const [task, setTask] = useState<AnalysisTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<{ topic?: string; video_engine?: "kling" | "seedance" | "auto" }>();

  async function refreshTask(analysisId?: string) {
    const id = analysisId || task?.analysis_id;
    if (!id) {
      return;
    }
    try {
      const next = await getAnalysisTask(id);
      setTask(next);
    } catch (error) {
      messageApi.error((error as Error).message);
    }
  }

  useEffect(() => {
    if (!task?.analysis_id || task.status !== "processing") {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshTask(task.analysis_id);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [task?.analysis_id, task?.status]);

  async function handleUpload(file: File) {
    setLoading(true);
    try {
      const result = await uploadAnalysisVideo(file);
      setTask({
        analysis_id: result.analysis_id,
        status: "processing"
      });
      messageApi.success(result.message);
    } catch (error) {
      messageApi.error((error as Error).message);
    } finally {
      setLoading(false);
    }
    return false;
  }

  async function handleReplace(characterId: number, file: File) {
    if (!task?.analysis_id) {
      return false;
    }
    try {
      await replaceAnalysisCharacter(task.analysis_id, characterId, file);
      messageApi.success("人物替换参考图已更新");
      await refreshTask();
    } catch (error) {
      messageApi.error((error as Error).message);
    }
    return false;
  }

  async function handleRemove(characterId: number) {
    if (!task?.analysis_id) {
      return;
    }
    try {
      await removeAnalysisCharacter(task.analysis_id, characterId);
      messageApi.success("已删除替换参考图");
      await refreshTask();
    } catch (error) {
      messageApi.error((error as Error).message);
    }
  }

  async function handleCreateProject(values: { topic?: string; video_engine?: "kling" | "seedance" | "auto" }) {
    if (!task?.analysis_id) {
      return;
    }
    setCreating(true);
    try {
      const result = await createProjectFromAnalysis(task.analysis_id, {
        topic: values.topic,
        video_engine: values.video_engine || "kling",
        add_subtitles: true
      });
      messageApi.success(`${result.message}，项目 ${result.project_id}`);
    } catch (error) {
      messageApi.error((error as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const sceneItems = useMemo(
    () =>
      (task?.result?.scenes || []).map((scene) => ({
        key: String(scene.scene_id),
        label: `Scene ${scene.scene_id} · ${scene.duration}s`,
        children: (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Typography.Text>{scene.voiceover}</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              图像提示词：{scene.image_prompt}
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              视频提示词：{scene.video_prompt}
            </Typography.Paragraph>
          </Space>
        )
      })),
    [task]
  );

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      {contextHolder}
      <div className="workspace-header">
        <div className="workspace-title">
          <Typography.Title level={2}>对标视频分析</Typography.Title>
          <Typography.Paragraph type="secondary">
            上传一个参考视频，自动拆解人物、分镜、提示词和整体风格，再直接创建新项目。
          </Typography.Paragraph>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void refreshTask()} disabled={!task?.analysis_id}>
          刷新
        </Button>
      </div>

      <Card className="lingti-card">
        <Upload.Dragger accept="video/*" beforeUpload={handleUpload} showUploadList={false} disabled={loading}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">拖入或点击上传对标视频</p>
          <p className="ant-upload-hint">支持 mp4 / mov / avi / mkv / webm / flv</p>
        </Upload.Dragger>
      </Card>

      {task ? (
        <Row gutter={[24, 24]}>
          <Col xs={24} xl={8}>
            <Space direction="vertical" size={24} style={{ width: "100%" }}>
              <Card className="lingti-card" title="分析状态">
                <DescriptionsBlock
                  rows={[
                    ["任务 ID", task.analysis_id],
                    ["状态", task.status],
                    ["文件名", task.filename || "-"],
                    ["创建时间", task.created_at || "-"]
                  ]}
                />
                {task.status === "processing" ? (
                  <Alert
                    style={{ marginTop: 16 }}
                    type="info"
                    showIcon
                    message="Gemini 分析中"
                    description="页面会自动轮询结果。"
                  />
                ) : null}
                {task.status === "failed" ? (
                  <Alert
                    style={{ marginTop: 16 }}
                    type="error"
                    showIcon
                    message="分析失败"
                    description={task.error || "未知错误"}
                  />
                ) : null}
              </Card>

              <Card className="lingti-card" title="基于分析创建项目">
                <Form form={form} layout="vertical" onFinish={handleCreateProject} initialValues={{ video_engine: "kling" }}>
                  <Form.Item name="topic" label="新项目主题">
                    <Input placeholder="留空则使用分析出的标题" />
                  </Form.Item>
                  <Form.Item name="video_engine" label="视频引擎">
                    <Select
                      options={[
                        { value: "kling", label: "Kling" },
                        { value: "seedance", label: "Seedance" },
                        { value: "auto", label: "Auto" }
                      ]}
                    />
                  </Form.Item>
                  <Button
                    type="primary"
                    htmlType="submit"
                    icon={<PlayCircleOutlined />}
                    loading={creating}
                    disabled={task.status !== "completed"}
                  >
                    创建项目
                  </Button>
                </Form>
              </Card>
            </Space>
          </Col>

          <Col xs={24} xl={16}>
            {task.status === "completed" && task.result ? (
              <Space direction="vertical" size={24} style={{ width: "100%" }}>
                <Card className="lingti-card" title="整体分析">
                  <Space direction="vertical" size={10} style={{ width: "100%" }}>
                    <Typography.Title level={4} style={{ margin: 0 }}>
                      {task.result.title}
                    </Typography.Title>
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                      {task.result.style}
                    </Typography.Paragraph>
                    <Space wrap>
                      <Tag color="blue">{task.result.aspect_ratio}</Tag>
                      <Tag color="cyan">{task.result.total_duration}s</Tag>
                      <Tag color="geekblue">{task.result.color_grade}</Tag>
                    </Space>
                    <Typography.Paragraph style={{ marginBottom: 0 }}>
                      全局风格提示词：{task.result.overall_prompt}
                    </Typography.Paragraph>
                  </Space>
                </Card>

                <Card className="lingti-card" title="人物替换">
                  {task.result.characters.length ? (
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      {task.result.characters.map((character) => (
                        <div key={character.character_id} className="artifact-item">
                          <Space direction="vertical" size={10} style={{ width: "100%" }}>
                            <Space wrap>
                              <Tag color="blue">{character.name}</Tag>
                              {character.replacement_image ? <Tag color="green">已替换</Tag> : <Tag>使用原人物</Tag>}
                            </Space>
                            <Typography.Text>{character.description}</Typography.Text>
                            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                              {character.appearance_prompt}
                            </Typography.Paragraph>
                            <Space wrap>
                              <Upload beforeUpload={(file) => handleReplace(character.character_id, file)} showUploadList={false}>
                                <Button icon={<UploadOutlined />}>上传替换图</Button>
                              </Upload>
                              {character.replacement_image ? (
                                <Button icon={<SwapOutlined />} onClick={() => void handleRemove(character.character_id)}>
                                  移除替换图
                                </Button>
                              ) : null}
                            </Space>
                          </Space>
                        </div>
                      ))}
                    </Space>
                  ) : (
                    <Empty description="没有识别到可替换人物" />
                  )}
                </Card>

                <Card className="lingti-card" title="分镜拆解">
                  <Collapse items={sceneItems} />
                </Card>
              </Space>
            ) : (
              <Card className="lingti-card">
                <Empty description="上传视频后，这里会显示人物、分镜和提示词分析结果。" />
              </Card>
            )}
          </Col>
        </Row>
      ) : null}
    </Space>
  );
}

function DescriptionsBlock({ rows }: { rows: Array<[string, string | number]> }) {
  return (
    <Space direction="vertical" size={10} style={{ width: "100%" }}>
      {rows.map(([label, value]) => (
        <div key={label} className="system-stat-row">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </Space>
  );
}
