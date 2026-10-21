# npm 发布与插件中心收录

包名为 `dsp-rdp`，发布目标为公共 npm registry：`https://registry.npmjs.org/`。
`0.2.4` 补齐 npm 发布配置；配置完成不代表包已发布或插件中心已展示。

## 用户安装

在 npm 发布完成后，可使用：

```bash
dsh plugin --profile web add dsp-rdp
```

发布前仍可使用 GitHub 安装方式：

```bash
dsh plugin --profile web add github:andarmworld/dsp-rdp
```

安装插件不会自动部署 Guacamole。仍须按 README 配置 Guacamole 1.6.0、PostgreSQL、同站点反向代理及 DSH 认证。npm 包包含预构建的客户端和服务端，用户无需安装编译工具；网关模板位于 `gateway/compose.yaml`。

## 维护者发布

1. 只在本项目提交待发布内容，更新版本号和 CHANGELOG，记录验证结果。不要将未提交的修改、凭据或运行数据带入发布包。
2. 从该提交创建独立构建目录，安装开发依赖，验证并打包：

   ```bash
   npm ci
   npm run typecheck
   npm test
   npm pack --pack-destination /absolute/path/to/release-artifacts
   ```

   `prepack` 会重新构建；编译失败时停止打包。检查 tarball 文件清单，再在临时项目中使用 `npm install --omit=dev /absolute/path/to/dsp-rdp-0.2.4.tgz` 验证运行依赖和入口。只打包声明的运行文件、说明、截图及网关模板；不包含网关 `.env`、初始化数据库、密钥或开发依赖。
3. 使用自己的 npm 账号在终端执行 `npm login --registry=https://registry.npmjs.org`，完成浏览器认证。不要将令牌提交到仓库。
4. 确认发布目标和版本后，发布已验证的同一份 tarball：

   ```bash
   npm publish /absolute/path/to/dsp-rdp-0.2.4.tgz --access public --registry=https://registry.npmjs.org/
   npm view dsp-rdp@0.2.4 version dist.integrity --registry=https://registry.npmjs.org/
   ```

   直接从源码执行 `npm publish` 时，`prepublishOnly` 会先执行类型检查和测试，随后 `prepack` 构建。发布 tarball 时不重新执行源码检查，因此必须先完成第 2 步并发布原包。
5. 记录 registry、版本、源码提交哈希、tarball SHA-512 / integrity、验证结果和实际发布时间。未成功发布时记录阻碍，不能标记为已上架。

## 收录状态

[提交 #224](https://github.com/dshplugin/dsh-plugin-hub/issues/224) 已被维护者标记完成，[网站详情页](https://dsh-plugin.org/zh/plugins/andarmworld/dsp-rdp) 已展示插件。维护者说明，应用内插件中心只展示支持 npm 一键安装的插件；发布后还需等待其目录扫描，并实际检查列表与安装命令。

DSH Plugin Hub 是独立社区市场，与 DeepSeek 官方无隶属关系。npm 发布成功也不等于 DeepSeek 官方认证。
