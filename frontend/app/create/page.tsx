"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Space, Typography } from "antd";

import { CreateProjectForm } from "@/components/create-project-form";

export default function CreatePage() {
  const [createdProjectId, setCreatedProjectId] = useState<string>();

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      <div className="workspace-title">
        <Typography.Title level={2}>快速生成</Typography.Title>
        <Typography.Paragraph type="secondary">
          面向普通运营同学的轻量入口。先把项目跑起来，再去详情页看进度和结果。
        </Typography.Paragraph>
      </div>

      {createdProjectId ? (
        <Alert
          type="success"
          showIcon
          message={`项目 ${createdProjectId} 已启动`}
          description={
            <Space>
              <Link href={`/projects/${createdProjectId}`}>
                <Button type="link">查看详情</Button>
              </Link>
              <Link href="/studio">
                <Button type="link">去专业工作台</Button>
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
