"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Button, Card, Col, Row, Space, Tag, Typography } from "antd";
import {
  ApiOutlined,
  CompassOutlined,
  DeploymentUnitOutlined,
  PlaySquareOutlined
} from "@ant-design/icons";

import { useLanguage } from "@/components/language-provider";
import { ProjectsPanel } from "@/components/projects-panel";
import { getApiBase, getConnectorStatus, getSystemHealth, getSystemSetup } from "@/lib/api";
import type { ConnectorStatus, SystemHealth, SystemSetup } from "@/lib/types";

export default function HomePage() {
  const { isZh } = useLanguage();
  const [refreshToken] = useState(0);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [connectors, setConnectors] = useState<ConnectorStatus | null>(null);
  const [setup, setSetup] = useState<SystemSetup | null>(null);
  const [apiBase, setApiBase] = useState<string>("");

  useEffect(() => {
    setApiBase(getApiBase());
    void Promise.all([getSystemHealth(), getConnectorStatus(), getSystemSetup()])
      .then(([health, nextConnectors, nextSetup]) => {
        setSystemHealth(health);
        setConnectors(nextConnectors);
        setSetup(nextSetup);
      })
      .catch(() => undefined);
  }, []);

  const entryCards = [
    {
      href: "/create",
      icon: <PlaySquareOutlined />,
      title: isZh ? "快速生成" : "Quick Create",
      description: isZh
        ? "给运营同学。只填主题、时长和素材，按推荐值启动工作流。"
        : "For operators. Start a workflow with topic, duration, and assets only."
    },
    {
      href: "/studio",
      icon: <DeploymentUnitOutlined />,
      title: isZh ? "专业工作台" : "Studio",
      description: isZh
        ? "给你和内部团队。集中看日志、审核、恢复、下载和排错。"
        : "For internal power users. Review logs, approvals, recovery, downloads, and debugging."
    },
    {
      href: "/analyze",
      icon: <CompassOutlined />,
      title: isZh ? "对标分析" : "Reference Analysis",
      description: isZh
        ? "上传一个参考视频，自动拆解人物、分镜和风格，再生成新项目。"
        : "Upload a reference video, break down characters, scenes, and style, then create a new project."
    }
  ];

  return (
    <Space direction="vertical" size={28} style={{ width: "100%" }}>
      {setup?.onboarding_required ? (
        <Alert
          type="warning"
          showIcon
          message={isZh ? "首次使用前请先完成配置" : "Complete setup before your first run"}
          description={
            <Space direction="vertical" size={4}>
              <span>{isZh ? "系统已经弹出配置窗口。你也可以进入 Setup 页面继续编辑。" : "The setup dialog has already opened. You can also continue editing from the Setup page."}</span>
              {!setup.config_exists ? (
                <span>{isZh ? "本地 config.yaml 还不存在，第一次保存配置时会自动创建。" : "No local config.yaml was found. It will be created automatically the first time you save setup."}</span>
              ) : null}
              {setup.missing_requirements.map((item) => (
                <span key={item.key}>{item.message}</span>
              ))}
            </Space>
          }
        />
      ) : null}
      <section className="hero-panel">
        <div className="hero-copy">
          <Tag color="blue" bordered={false}>
            LingtiStudio
          </Tag>
          <Typography.Title level={1}>The greyhound-speed AI video workflow</Typography.Title>
          <Typography.Paragraph>
            {isZh
              ? "Lingti 在中文里是灵缇，速度极快。LingtiStudio 帮你把一个想法变成完整的视频工作流，覆盖脚本生成、审核、素材生产、视频片段、恢复与交付。"
              : "Lingti means greyhound in Chinese, the fastest dog. LingtiStudio helps you turn an idea into a full video workflow with script generation, review, assets, video clips, recovery, and delivery."}
          </Typography.Paragraph>
          <Space wrap>
            <Link href="/create">
              <Button type="primary" size="large">
                {isZh ? "进入快速生成" : "Open Quick Create"}
              </Button>
            </Link>
            <Link href="/studio">
              <Button size="large">{isZh ? "进入专业工作台" : "Open Studio"}</Button>
            </Link>
            <Link href="/settings">
              <Button size="large" icon={<ApiOutlined />}>
                {isZh ? "打开设置" : "Open Setup"}
              </Button>
            </Link>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
            {isZh ? "当前后端地址：" : "Current API base:"}
            {apiBase || (isZh ? "检测中..." : "Detecting...")}
          </Typography.Paragraph>
        </div>

        <div className="hero-status">
          <Card className="lingti-card lingti-card-soft">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {isZh ? "系统概览" : "System Overview"}
              </Typography.Title>
              <div className="system-stat-row">
                <span>{isZh ? "系统状态" : "Status"}</span>
                <strong>{systemHealth?.status || (isZh ? "加载中" : "Loading")}</strong>
              </div>
              <div className="system-stat-row">
                <span>{isZh ? "默认视频引擎" : "Default video provider"}</span>
                <strong>{connectors?.video.default_provider || systemHealth?.defaults.video_provider || "-"}</strong>
              </div>
              <div className="system-stat-row">
                <span>{isZh ? "默认 LLM" : "Default LLM"}</span>
                <strong>{connectors?.llm.default_provider || systemHealth?.defaults.llm_provider || "-"}</strong>
              </div>
              <div className="system-stat-row">
                <span>{isZh ? "图片服务" : "Image provider"}</span>
                <strong>{connectors?.image.provider || systemHealth?.defaults.image_provider || "-"}</strong>
              </div>
              <div className="system-stat-row">
                <span>{isZh ? "TTS 模式" : "TTS mode"}</span>
                <strong>{connectors?.tts.voice_catalog_supported ? (isZh ? "MiniMax 音色目录" : "MiniMax voice catalog") : (isZh ? "手动 voice_id" : "Manual voice_id")}</strong>
              </div>
            </Space>
          </Card>
        </div>
      </section>

      <Row gutter={[24, 24]}>
        {entryCards.map((card) => (
          <Col xs={24} md={8} key={card.href}>
            <Link href={card.href}>
              <Card className="lingti-card lingti-entry-card">
                <Space direction="vertical" size={16}>
                  <div className="entry-icon">{card.icon}</div>
                  <div>
                    <Typography.Title level={3}>{card.title}</Typography.Title>
                    <Typography.Paragraph type="secondary">{card.description}</Typography.Paragraph>
                  </div>
                </Space>
              </Card>
            </Link>
          </Col>
        ))}
      </Row>

      <ProjectsPanel refreshToken={refreshToken} compact />
    </Space>
  );
}
