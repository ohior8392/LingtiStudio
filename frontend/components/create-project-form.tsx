"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  Upload,
  message
} from "antd";
import { CustomerServiceOutlined, InboxOutlined, RocketOutlined, SoundOutlined, UploadOutlined } from "@ant-design/icons";
import type { UploadFile, UploadProps } from "antd";

import { createProject, getConnectorStatus, isSetupRequiredError, listTtsVoices, previewTtsVoice, uploadReference } from "@/lib/api";
import type { ConnectorStatus, VoiceOption } from "@/lib/types";

interface Props {
  onCreated: (projectId: string) => void;
  variant?: "simple" | "studio";
}

interface FormValues {
  topic: string;
  style?: string;
  target_duration: number;
  voice_id?: string;
  video_engine: "kling" | "seedance" | "auto";
  resolution: "720p" | "1080p" | "4K";
  aspect_ratio: "9:16" | "16:9";
  add_subtitles: boolean;
  global_style_prompt?: string;
}

export function CreateProjectForm({ onCreated, variant = "studio" }: Props) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceLoading, setVoiceLoading] = useState(true);
  const [voiceFallback, setVoiceFallback] = useState(false);
  const [connectors, setConnectors] = useState<ConnectorStatus | null>(null);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string>();
  const [voiceLanguageFilter, setVoiceLanguageFilter] = useState<string>("all");
  const [voiceTagFilter, setVoiceTagFilter] = useState<string>("all");
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ uid: string; path: string }>>([]);
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const uploadProps: UploadProps = useMemo(
    () => ({
      multiple: true,
      fileList,
      customRequest: async ({ file, onSuccess, onError }) => {
        try {
          const currentFile = file as UploadFile;
          const result = await uploadReference(file as File);
          setUploadedFiles((prev) => [...prev, { uid: currentFile.uid, path: result.path }]);
          onSuccess?.(result);
          messageApi.success(`${result.filename} 上传成功`);
        } catch (error) {
          onError?.(error as Error);
          messageApi.error((error as Error).message);
        }
      },
      onChange: ({ fileList: nextFileList }) => {
        setFileList(nextFileList);
      },
      onRemove: (file) => {
        setUploadedFiles((prev) => prev.filter((item) => item.uid !== file.uid));
      }
    }),
    [fileList, messageApi]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadConfigAwareVoices() {
      setVoiceLoading(true);
      try {
        const connectorData = await getConnectorStatus();
        if (cancelled) {
          return;
        }
        setConnectors(connectorData);

        const initialVoice = form.getFieldValue("voice_id") || connectorData.tts.default_voice;
        if (initialVoice) {
          form.setFieldValue("voice_id", initialVoice);
          setSelectedVoiceId(initialVoice);
        }

        if (!connectorData.tts.voice_catalog_supported) {
          setVoices([]);
          setVoiceFallback(false);
          return;
        }

        const result = await listTtsVoices({ source: "system" });
        if (cancelled) {
          return;
        }
        setVoices(result.voices);
        setVoiceFallback(result.fallback);
        const catalogVoice = form.getFieldValue("voice_id") || result.default_voice || result.voices[0]?.id;
        if (catalogVoice) {
          form.setFieldValue("voice_id", catalogVoice);
          setSelectedVoiceId(catalogVoice);
        }
      } catch (error) {
        if (!cancelled) {
          messageApi.error((error as Error).message);
        }
      } finally {
        if (!cancelled) {
          setVoiceLoading(false);
        }
      }
    }

    void loadConfigAwareVoices();

    return () => {
      cancelled = true;
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [form, messageApi]);

  const supportsVoiceCatalog = connectors?.tts.voice_catalog_supported ?? true;

  const selectedVoice = useMemo(
    () => voices.find((item) => item.id === (selectedVoiceId || form.getFieldValue("voice_id"))),
    [form, selectedVoiceId, voices]
  );

  const voiceLanguages = useMemo(
    () => Array.from(new Set(voices.map((item) => item.language).filter(Boolean))).sort(),
    [voices]
  );

  const voiceTags = useMemo(
    () => Array.from(new Set(voices.flatMap((item) => item.tags || []).filter(Boolean))).sort(),
    [voices]
  );

  const visibleVoices = useMemo(() => {
    return voices.filter((voice) => {
      if (voiceLanguageFilter !== "all" && voice.language !== voiceLanguageFilter) {
        return false;
      }
      if (voiceTagFilter !== "all" && !(voice.tags || []).includes(voiceTagFilter)) {
        return false;
      }
      return true;
    });
  }, [voiceLanguageFilter, voiceTagFilter, voices]);

  const groupedVoiceOptions = useMemo(() => {
    const groups = new Map<string, VoiceOption[]>();
    for (const voice of visibleVoices) {
      const key = voice.language || "other";
      const list = groups.get(key) || [];
      list.push(voice);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).map(([language, groupVoices]) => ({
      label: `${language} · ${groupVoices.length} 个音色`,
      options: groupVoices.map((voice) => ({
        value: voice.id,
        label: `${voice.name} · ${voice.tags.slice(0, 2).join(" / ") || "general"}`,
      })),
    }));
  }, [visibleVoices]);

  async function handlePreview() {
    const voiceId = form.getFieldValue("voice_id");
    if (!voiceId) {
      messageApi.warning("请先选择一个音色");
      return;
    }
    setPreviewingVoiceId(voiceId);
    try {
      const result = await previewTtsVoice(voiceId);
      audioRef.current?.pause();
      audioRef.current = new Audio(result.audio_url);
      audioRef.current.onended = () => setPreviewingVoiceId(undefined);
      audioRef.current.onerror = () => setPreviewingVoiceId(undefined);
      await audioRef.current.play();
    } catch (error) {
      messageApi.error((error as Error).message);
      setPreviewingVoiceId(undefined);
      return;
    }
  }

  async function onFinish(values: FormValues) {
    setSubmitting(true);
    try {
      const result = await createProject({
        ...values,
        reference_images: uploadedFiles.map((item) => item.path)
      });
      messageApi.success(result.message);
      onCreated(result.project_id);
      form.resetFields();
      if (selectedVoiceId) {
        form.setFieldValue("voice_id", selectedVoiceId);
      }
      setUploadedFiles([]);
      setFileList([]);
    } catch (error) {
      if (isSetupRequiredError(error)) {
        messageApi.warning("当前配置不完整，已经为你打开 Setup 配置窗口。");
      } else {
        messageApi.error((error as Error).message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const isSimple = variant === "simple";

  return (
    <Card className={`lingti-card ${isSimple ? "lingti-card-soft" : ""}`}>
      {contextHolder}
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        <div className="workspace-title">
          <Typography.Title level={3}>
            {isSimple ? "快速发起一个视频任务" : "专业工作台 · 新建任务"}
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            {isSimple
              ? "只填核心信息就能开始。高级参数默认走推荐值，需要时再展开。"
              : "保留完整控制项，适合频繁创建、排错、恢复和精调工作流。"}
          </Typography.Paragraph>
        </div>
        <Form<FormValues>
          form={form}
          layout="vertical"
          initialValues={{
            target_duration: isSimple ? 40 : 60,
            video_engine: "kling",
            resolution: "1080p",
            aspect_ratio: "9:16",
            add_subtitles: true
          }}
          onFinish={onFinish}
        >
          <Form.Item
            name="topic"
            label="主题需求"
            rules={[{ required: true, message: "请输入主题" }]}
          >
            <Input.TextArea
              rows={isSimple ? 5 : 4}
              placeholder="例如：几个老年人在现代化酒店里休闲打牌，前景讲解养老项目，画面高端优雅"
              showCount
              maxLength={800}
            />
          </Form.Item>
          <Form.Item name="style" label="风格描述">
            <Input placeholder="例如：高级酒店广告、温暖阳光、克制旁白" />
          </Form.Item>

          <Card className="lingti-mini-card voice-card" size="small">
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <div className="voice-card-header">
                <Space>
                  <CustomerServiceOutlined />
                  <Typography.Text strong>旁白音色</Typography.Text>
                  {supportsVoiceCatalog ? (
                    voiceFallback ? <Tag color="gold">回退列表</Tag> : <Tag color="blue">MiniMax 官方目录</Tag>
                  ) : (
                    <Tag color="default">手动 voice_id</Tag>
                  )}
                </Space>
                {supportsVoiceCatalog ? (
                  <Button
                    type="default"
                    icon={<SoundOutlined />}
                    loading={Boolean(previewingVoiceId)}
                    onClick={() => void handlePreview()}
                    disabled={!form.getFieldValue("voice_id")}
                  >
                    试听当前音色
                  </Button>
                ) : null}
              </div>

              {supportsVoiceCatalog ? (
                <Form.Item name="voice_id" label="选择音色" style={{ marginBottom: 0 }}>
                  <Select
                    showSearch
                    loading={voiceLoading}
                    optionFilterProp="label"
                    placeholder="请选择一个旁白音色"
                    options={groupedVoiceOptions}
                    onChange={(value) => setSelectedVoiceId(value)}
                    notFoundContent={voiceLoading ? "音色加载中..." : "当前筛选下没有可用音色"}
                  />
                </Form.Item>
              ) : (
                <Form.Item name="voice_id" label="填写 voice_id" style={{ marginBottom: 0 }}>
                  <Input placeholder="当前 TTS provider 不依赖 MiniMax 音色目录，请手动输入 voice_id" />
                </Form.Item>
              )}

              {supportsVoiceCatalog ? (
                <Space wrap size={12}>
                  <Select
                    size="small"
                    value={voiceLanguageFilter}
                    style={{ width: 156 }}
                    onChange={setVoiceLanguageFilter}
                    options={[
                      { value: "all", label: "全部语言" },
                      ...voiceLanguages.map((language) => ({ value: language, label: language })),
                    ]}
                  />
                  <Select
                    size="small"
                    value={voiceTagFilter}
                    style={{ width: 168 }}
                    onChange={setVoiceTagFilter}
                    options={[
                      { value: "all", label: "全部风格" },
                      ...voiceTags.map((tag) => ({ value: tag, label: tag })),
                    ]}
                  />
                  <Typography.Text type="secondary">
                    当前显示 {visibleVoices.length} / {voices.length} 个音色
                  </Typography.Text>
                </Space>
              ) : null}

              {supportsVoiceCatalog && voiceFallback ? (
                <Alert
                  type="warning"
                  showIcon
                  message="官方音色目录暂时不可用"
                  description="当前展示的是本地回退音色列表，你仍然可以继续创建并生成视频。"
                />
              ) : !supportsVoiceCatalog ? (
                <Alert
                  type="info"
                  showIcon
                  message="当前 TTS provider 不提供内置音色目录"
                  description="创建任务时会直接把你填写的 voice_id 传给后端，不再显示 MiniMax 音色选择器。"
                />
              ) : null}

              {supportsVoiceCatalog && selectedVoice ? (
                <div className="voice-card-meta">
                  <Space wrap size={[8, 8]}>
                    <Tag color="cyan">{selectedVoice.language}</Tag>
                    <Tag color={selectedVoice.source_type === "system" ? "blue" : "purple"}>
                      {selectedVoice.source_type}
                    </Tag>
                    {selectedVoice.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </Space>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    {selectedVoice.description || "这个音色适合做视频旁白、讲解或人物对白。"}
                  </Typography.Paragraph>
                  <Typography.Text type="secondary">
                    试听文案固定为一段标准旁白，便于你快速横向比较不同音色。
                  </Typography.Text>
                </div>
              ) : null}
            </Space>
          </Card>

          <Space wrap size={16} style={{ display: "flex", marginBottom: 8 }}>
            <Form.Item name="target_duration" label="目标时长">
              <InputNumber min={15} max={180} />
            </Form.Item>
            <Form.Item name="aspect_ratio" label="画面比例">
              <Select
                style={{ width: 144 }}
                options={[
                  { value: "9:16", label: "9:16 竖屏" },
                  { value: "16:9", label: "16:9 横屏" }
                ]}
              />
            </Form.Item>
            <Form.Item name="add_subtitles" label="字幕" valuePropName="checked">
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
          </Space>

          <Form.Item label="参考图 / 参考视频">
            <Upload.Dragger {...uploadProps} accept="image/*,video/*">
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">上传人物图、产品图或参考视频</p>
              <p className="ant-upload-hint">
                当前已上传 {uploadedFiles.length} 个素材，后端会自动用作参考图或截帧。
              </p>
            </Upload.Dragger>
          </Form.Item>

          <Collapse
            ghost
            className="lingti-collapse"
            items={[
              {
                key: "advanced",
                label: isSimple ? "高级参数" : "引擎与一致性设置",
                children: (
                  <>
                    <Space wrap size={16} style={{ display: "flex", marginBottom: 8 }}>
                      <Form.Item name="video_engine" label="视频引擎">
                        <Select
                          style={{ width: 144 }}
                          options={[
                            { value: "kling", label: "Kling" },
                            { value: "seedance", label: "Seedance" },
                            { value: "auto", label: "Auto" }
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name="resolution" label="分辨率">
                        <Select
                          style={{ width: 144 }}
                          options={[
                            { value: "720p", label: "720p" },
                            { value: "1080p", label: "1080p" },
                            { value: "4K", label: "4K" }
                          ]}
                        />
                      </Form.Item>
                    </Space>
                    <Form.Item name="global_style_prompt" label="全局风格提示词">
                      <Input placeholder="用于约束全片风格一致性，可留空" />
                    </Form.Item>
                  </>
                )
              }
            ]}
          />

          <Button
            type="primary"
            htmlType="submit"
            size="large"
            loading={submitting}
            icon={isSimple ? <RocketOutlined /> : <UploadOutlined />}
          >
            {isSimple ? "开始生成" : "启动工作流"}
          </Button>
        </Form>
      </Space>
    </Card>
  );
}
