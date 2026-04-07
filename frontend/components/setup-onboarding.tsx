"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Modal, Space, Typography } from "antd";

import { ConfigurationForm } from "@/components/configuration-form";
import { useLanguage } from "@/components/language-provider";
import { getSystemSetup } from "@/lib/api";
import type { SystemSetup } from "@/lib/types";

export function SetupOnboarding() {
  const { isZh } = useLanguage();
  const [setup, setSetup] = useState<SystemSetup | null>(null);
  const [open, setOpen] = useState(false);

  async function refreshSetup() {
    const nextSetup = await getSystemSetup();
    setSetup(nextSetup);
    setOpen(nextSetup.onboarding_required);
  }

  useEffect(() => {
    void refreshSetup().catch(() => undefined);
  }, []);

  useEffect(() => {
    function handleOpen(event: Event) {
      const nextSetup = (event as CustomEvent<SystemSetup | null>).detail;
      if (nextSetup) {
        setSetup(nextSetup);
        setOpen(true);
        return;
      }
      void refreshSetup().catch(() => undefined);
    }

    window.addEventListener("lingti:open-setup", handleOpen as EventListener);
    return () => {
      window.removeEventListener("lingti:open-setup", handleOpen as EventListener);
    };
  }, []);

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      width={920}
      maskClosable={false}
      title={isZh ? "欢迎使用 LingtiStudio" : "Welcome to LingtiStudio"}
      destroyOnHidden
    >
      <Space direction="vertical" size={18} style={{ width: "100%" }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {isZh
            ? "在开始生成视频前，先完成最小可用配置。你可以选择默认 provider、模型，并把配置直接写入本地 `configs/config.yaml`。如果本地还没有这个文件，这里保存后会自动创建。"
            : "Before generating videos, complete the minimum setup first. Choose the default providers and models, then write them directly into your local `configs/config.yaml`. If the file does not exist yet, it will be created automatically when you save."}
        </Typography.Paragraph>
        {setup?.missing_requirements?.length ? (
          <Alert
            type="warning"
            showIcon
            message={isZh ? "当前项目还缺少必需配置" : "Required configuration is still missing"}
            description={
              <Space direction="vertical" size={4}>
                {setup.missing_requirements.map((item) => (
                  <span key={item.key}>{item.message}</span>
                ))}
              </Space>
            }
          />
        ) : null}
        <ConfigurationForm
          setup={setup}
          submitText={isZh ? "保存并开始使用" : "Save and start"}
          showTitle
          onSaved={async () => {
            await refreshSetup();
            setOpen(false);
          }}
        />
        <Button type="text" onClick={() => setOpen(false)}>
          {isZh ? "稍后再配" : "Later"}
        </Button>
      </Space>
    </Modal>
  );
}
