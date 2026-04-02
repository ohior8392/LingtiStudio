"use client";

import { ReactNode } from "react";
import { ConfigProvider, theme } from "antd";
import { AntdRegistry } from "@ant-design/nextjs-registry";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AntdRegistry>
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: "#3b82f6",
            colorInfo: "#60a5fa",
            colorSuccess: "#4ade80",
            colorWarning: "#fb923c",
            colorBgLayout: "#08111f",
            colorBgContainer: "#0f172a",
            colorText: "#e5eefc",
            colorTextSecondary: "#9fb2d4",
            colorBorder: "rgba(96, 165, 250, 0.16)",
            borderRadius: 18,
            fontSize: 14
          },
          components: {
            Layout: {
              siderBg: "#0b1220",
              triggerBg: "#111c32"
            },
            Menu: {
              darkItemBg: "#0b1220",
              darkItemSelectedBg: "rgba(59, 130, 246, 0.22)",
              darkItemColor: "#9fb2d4",
              darkItemSelectedColor: "#e5eefc",
              darkSubMenuItemBg: "#0b1220"
            },
            Card: {
              bodyPadding: 22
            },
            Button: {
              borderRadius: 14
            }
          }
        }}
      >
        {children}
      </ConfigProvider>
    </AntdRegistry>
  );
}
