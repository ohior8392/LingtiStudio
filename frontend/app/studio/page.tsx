"use client";

import { useState } from "react";
import { Card, Col, Empty, Row, Space, Typography } from "antd";

import { CreateProjectForm } from "@/components/create-project-form";
import { useLanguage } from "@/components/language-provider";
import { ProjectDetailClient } from "@/components/project-detail-client";
import { ProjectsPanel } from "@/components/projects-panel";

export default function StudioPage() {
  const { isZh } = useLanguage();
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();

  function handleCreated(projectId: string) {
    setSelectedProjectId(projectId);
    setRefreshToken((value) => value + 1);
  }

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      <div className="workspace-title">
        <Typography.Title level={2}>{isZh ? "专业工作台" : "Studio"}</Typography.Title>
        <Typography.Paragraph type="secondary">
          {isZh
            ? "集中创建任务、查看实时日志、审核脚本、恢复失败项目和下载成片。"
            : "Create projects, inspect live logs, review scripts, recover failed jobs, and download final outputs in one place."}
        </Typography.Paragraph>
      </div>

      <Row gutter={[24, 24]} align="top">
        <Col xs={24} xxl={8}>
          <CreateProjectForm onCreated={handleCreated} variant="studio" />
        </Col>
        <Col xs={24} xxl={16}>
          {selectedProjectId ? (
            <ProjectDetailClient
              projectId={selectedProjectId}
              embedded
              onDeleted={() => {
                setSelectedProjectId(undefined);
                setRefreshToken((value) => value + 1);
              }}
            />
          ) : (
            <Card className="lingti-card" style={{ minHeight: 360 }}>
              <Empty
                description={isZh ? "先创建一个任务，或者从下方任务中心里选一个项目继续查看。" : "Create a project first, or select one from the task center below."}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </Card>
          )}
        </Col>
        <Col span={24}>
          <ProjectsPanel
            refreshToken={refreshToken}
            selectedProjectId={selectedProjectId}
            onSelect={setSelectedProjectId}
          />
        </Col>
      </Row>
    </Space>
  );
}
