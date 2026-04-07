"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Space, Typography } from "antd";

import { useLanguage } from "@/components/language-provider";
import { CreateProjectForm } from "@/components/create-project-form";

export default function CreatePage() {
  const { isZh } = useLanguage();
  const [createdProjectId, setCreatedProjectId] = useState<string>();

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      <div className="workspace-title">
        <Typography.Title level={2}>{isZh ? "快速生成" : "Quick Create"}</Typography.Title>
        <Typography.Paragraph type="secondary">
          {isZh
            ? "面向普通运营同学的轻量入口。先把项目跑起来，再去详情页看进度和结果。"
            : "A lightweight flow for operators. Get the project running first, then inspect progress and results in the detail page."}
        </Typography.Paragraph>
      </div>

      {createdProjectId ? (
        <Alert
          type="success"
          showIcon
          message={isZh ? `项目 ${createdProjectId} 已启动` : `Project ${createdProjectId} started`}
          description={
            <Space>
              <Link href={`/projects/${createdProjectId}`}>
                <Button type="link">{isZh ? "查看详情" : "View details"}</Button>
              </Link>
              <Link href="/studio">
                <Button type="link">{isZh ? "去专业工作台" : "Open Studio"}</Button>
              </Link>
            </Space>
          }
        />
      ) : null}

      <Card className="lingti-card">
        <CreateProjectForm onCreated={setCreatedProjectId} variant="simple" />
      </Card>
    </Space>
  );
}
