"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layout, Menu, Segmented, Space, Tag, Typography } from "antd";
import {
  ApiOutlined,
  CompassOutlined,
  HomeOutlined,
  RocketOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import { useLanguage } from "@/components/language-provider";

const { Sider, Content } = Layout;

export function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const selectedKey = pathname.startsWith("/projects/") ? "/studio" : pathname;
  const { locale, isZh, setLocale } = useLanguage();

  return (
    <Layout className="app-shell">
      <Sider breakpoint="lg" collapsedWidth="0" width={292} className="app-sider">
        <div className="app-brand">
          <Space direction="vertical" size={10}>
            <Tag color="blue" bordered={false} style={{ width: "fit-content", margin: 0 }}>
              LingtiStudio
            </Tag>
            <Typography.Title level={3} style={{ color: "#f5edec", margin: 0 }}>
              LingtiStudio
            </Typography.Title>
            <Typography.Paragraph style={{ color: "#c8a8a8", margin: 0 }}>
              {isZh
                ? "像灵缇一样快速的 AI 视频工作流，覆盖创建、审核、恢复与交付。"
                : "The greyhound-speed AI video workflow for creation, review, recovery, and delivery."}
            </Typography.Paragraph>
            <Segmented
              size="small"
              value={locale}
              onChange={(value) => setLocale(value as "zh" | "en")}
              options={[
                { value: "zh", label: "中文" },
                { value: "en", label: "EN" },
              ]}
            />
          </Space>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={[
            {
              key: "/",
              icon: <HomeOutlined />,
              label: <Link href="/">{isZh ? "首页" : "Home"}</Link>
            },
            {
              key: "/create",
              icon: <ThunderboltOutlined />,
              label: <Link href="/create">{isZh ? "快速生成" : "Quick Create"}</Link>
            },
            {
              key: "/studio",
              icon: <RocketOutlined />,
              label: <Link href="/studio">{isZh ? "专业工作台" : "Studio"}</Link>
            },
            {
              key: "/analyze",
              icon: <CompassOutlined />,
              label: <Link href="/analyze">{isZh ? "对标分析" : "Reference Analysis"}</Link>
            },
            {
              key: "/settings",
              icon: <ApiOutlined />,
              label: <Link href="/settings">Setup</Link>
            }
          ]}
        />
        <div className="app-sider-note">
          <Space direction="vertical" size={8}>
            <span>{isZh ? "普通运营优先用“快速生成”。" : 'Start with "Quick Create" for simple jobs.'}</span>
            <span>{isZh ? "需要审核、恢复和日志排错时切到“专业工作台”。" : 'Use "Studio" for review, recovery, logs, and debugging.'}</span>
          </Space>
        </div>
      </Sider>
      <Layout className="app-main">
        <Content className="app-content">
          <div className="app-content-inner">{children}</div>
        </Content>
      </Layout>
    </Layout>
  );
}
