#!/usr/bin/env bash
# AI Context Hub — Demo Script
# Run: bash demo/run.sh
set -euo pipefail

HUB=$(mktemp -d)
export AI_CONTEXT_ROOT="$HUB"
trap 'rm -rf "$HUB"' EXIT

E="node W:/home/huyuanjun/ai_wp/codex/ai-context-hub/src/cli.js"

divider() { echo; printf '=%.0s' $(seq 1 60); echo; }

divider
echo "1. INIT — 初始化数据目录"
$E init

divider
echo "2. REMEMBER — 写入记忆"
$E remember "支付模块使用 Stripe API v2，不支持 v1 回调格式" --entity payment --confidence 1.0
$E remember "后端部署在 AWS us-east-1，RDS 实例 db.t3.xlarge" --entity infra --entity-type module
$E remember "张伟是前端团队 lead，负责组件库和设计系统" --entity zhang-wei --entity-type person

divider
echo "3. SYNC — syncing inbox → 图谱"
$E sync

divider
echo "4. SEARCH — 关键词搜索"
$E search "Stripe"

divider
echo "5. SEARCH — 语义搜索"
$E search "数据库配置" --semantic

divider
echo "6. RELATE — 建立关系"
$E relate --from zhang-wei --to payment --kind works_on --apply

divider
echo "7. RELATIONS — 查询关系"
$E relations zhang-wei

divider
echo "8. LIST — 列出所有实体"
$E list

divider
echo "9. DOCTOR — 健康检查"
$E doctor

divider
echo "✅ Demo 完成"
