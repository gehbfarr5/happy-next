# Happy Docs

Happy 项目文档，基于 [Mintlify](https://mintlify.com/) 构建。

## 本地开发

安装 Mintlify CLI：

```bash
npm i -g mint
```

启动本地预览：

```bash
cd packages/happy-docs
mint dev
```

访问 `http://localhost:3000` 查看预览。

## 目录结构

```
happy-docs/
├── docs.json          # Mintlify 配置文件
├── index.mdx          # 首页
├── quickstart.mdx     # 快速开始
├── development.mdx    # 开发指南
├── essentials/        # 基础文档
├── ai-tools/          # AI 工具集成
├── api-reference/     # API 参考
├── images/            # 图片资源
├── logo/              # Logo 文件
└── snippets/          # 可复用片段
```
