import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Space,
  Switch,
  Typography,
  message,
} from 'antd';
import { isGoodsPriceConfirmUrl, parseGoodsIdsFromActivityPage } from './auto-fill-from-page';
import {
  STORAGE_ACTIVITY_ASSIST_ENABLED,
  STORAGE_ACTIVITY_COST_TEMPLATE_ID,
  STORAGE_ACTIVITY_COST_TEMPLATE_NAME,
  STORAGE_ACTIVITY_DEBUG_LOGS,
  STORAGE_ACTIVITY_GOODS_IDS_CSV,
  STORAGE_ACTIVITY_PREPARED_GOODS_FP,
  STORAGE_ACTIVITY_PREPARED_TEMPLATE_ID,
  STORAGE_ACTIVITY_PREPARED_TEMPLATE_NAME,
} from '../constants/storage-keys';
type ActivityDebugPayload = {
  ts: number;
  level: string;
  message: string;
  detail?: string;
};

function formatDebugLine(p: ActivityDebugPayload): string {
  const t = new Date(p.ts).toLocaleTimeString('zh-CN', { hour12: false });
  const lv = (p.level ?? 'info').toUpperCase();
  const tail = p.detail ? `\n${p.detail}` : '';
  return `[${t}] ${lv} ${p.message}${tail}`;
}

function normalizeSingleGoodsId(raw: string): string {
  const part = raw.split(/[,，\s]+/)[0] ?? '';
  return part.replace(/\D/g, '');
}

export function ActivityAssistantPanel(): JSX.Element {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [debugLogs, setDebugLogs] = useState<ActivityDebugPayload[]>([]);
  const [prepareHint, setPrepareHint] = useState('');

  const tryAutofillGoodsIdFromPage = useCallback((): void => {
    try {
      const href = typeof window !== 'undefined' ? window.location.href : '';
      if (!isGoodsPriceConfirmUrl(href)) return;
      const ids = parseGoodsIdsFromActivityPage(href);
      const first = ids[0];
      if (!first) return;
      const next = String(first);
      const cur = normalizeSingleGoodsId(String(form.getFieldValue('goodsIdsCsv') ?? ''));
      if (cur === normalizeSingleGoodsId(next)) return;
      form.setFieldsValue({ goodsIdsCsv: next });
      void chrome.storage.local.set({ [STORAGE_ACTIVITY_GOODS_IDS_CSV]: normalizeSingleGoodsId(next) });
    } catch {
      /* ignore */
    }
  }, [form]);

  const load = useCallback(() => {
    void chrome.storage.local.get(
      [
        STORAGE_ACTIVITY_ASSIST_ENABLED,
        STORAGE_ACTIVITY_COST_TEMPLATE_ID,
        STORAGE_ACTIVITY_COST_TEMPLATE_NAME,
        STORAGE_ACTIVITY_GOODS_IDS_CSV,
        STORAGE_ACTIVITY_PREPARED_TEMPLATE_ID,
        STORAGE_ACTIVITY_PREPARED_TEMPLATE_NAME,
        STORAGE_ACTIVITY_PREPARED_GOODS_FP,
        STORAGE_ACTIVITY_DEBUG_LOGS,
      ],
      (r) => {
        if (chrome.runtime.lastError) return;
        form.setFieldsValue({
          enabled: r[STORAGE_ACTIVITY_ASSIST_ENABLED] !== false,
          goodsIdsCsv: r[STORAGE_ACTIVITY_GOODS_IDS_CSV] ?? '',
        });
        const raw = r[STORAGE_ACTIVITY_DEBUG_LOGS] as ActivityDebugPayload[] | undefined;
        setDebugLogs(Array.isArray(raw) ? raw : []);
        const pid = Number(r[STORAGE_ACTIVITY_PREPARED_TEMPLATE_ID]) || 0;
        if (pid > 0) {
          setPrepareHint(
            `分步已就绪：模板 ID ${pid}。新建模板名称为「商品ID-时间戳」（毫秒）；重名则换新时间戳重试。跟单解析不读面板旧「模板名称」字段。改 inject 常量后需 build 扩展。`
          );
        } else {
          setPrepareHint('');
        }
        setLoading(false);
      }
    );
  }, [form]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (loading) return;
    tryAutofillGoodsIdFromPage();
  }, [loading, tryAutofillGoodsIdFromPage]);

  useEffect(() => {
    const onStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName
    ): void => {
      if (area !== 'local') return;
      if (
        changes[STORAGE_ACTIVITY_ASSIST_ENABLED] ||
        changes[STORAGE_ACTIVITY_COST_TEMPLATE_ID] ||
        changes[STORAGE_ACTIVITY_COST_TEMPLATE_NAME] ||
        changes[STORAGE_ACTIVITY_GOODS_IDS_CSV] ||
        changes[STORAGE_ACTIVITY_PREPARED_TEMPLATE_ID] ||
        changes[STORAGE_ACTIVITY_PREPARED_TEMPLATE_NAME] ||
        changes[STORAGE_ACTIVITY_PREPARED_GOODS_FP]
      ) {
        load();
      }
      if (changes[STORAGE_ACTIVITY_DEBUG_LOGS]) {
        const nv = changes[STORAGE_ACTIVITY_DEBUG_LOGS].newValue as ActivityDebugPayload[] | undefined;
        setDebugLogs(Array.isArray(nv) ? nv : []);
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, [load]);

  const onSave = (): void => {
    const v = form.getFieldsValue() as {
      enabled?: boolean;
      goodsIdsCsv?: string;
    };
    const gid = normalizeSingleGoodsId(v.goodsIdsCsv ?? '');
    if (v.enabled !== false && !gid) {
      void message.warning('启用时请填写或自动识别当前报名商品 ID');
      return;
    }
    if (v.enabled !== false && (gid.length < 6 || gid.length > 15)) {
      void message.warning('商品 ID 应为 6～15 位数字');
      return;
    }
    void chrome.storage.local.set(
      {
        [STORAGE_ACTIVITY_ASSIST_ENABLED]: v.enabled !== false,
        [STORAGE_ACTIVITY_GOODS_IDS_CSV]: gid,
        [STORAGE_ACTIVITY_COST_TEMPLATE_ID]: 0,
        [STORAGE_ACTIVITY_COST_TEMPLATE_NAME]: '',
      },
      () => {
        if (chrome.runtime.lastError) {
          void message.error(chrome.runtime.lastError.message);
          return;
        }
        void message.success('已保存');
        form.setFieldsValue({ goodsIdsCsv: gid });
      }
    );
  };

  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        活动助手 · 内蒙古不包邮
      </Typography.Title>
      <Form form={form} layout="vertical" disabled={loading} initialValues={{ enabled: true }}>
        <Form.Item label="启用活动助手（跟单，不拦截报名请求）" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          label="当前报名商品 ID"
          name="goodsIdsCsv"
          extra="单商品跟单：只填一个 ID。在活动价确认页（goods_price/confirm）打开本面板时，会用**当前页「商品信息」里的 ID**自动填入或**纠正**与本地不一致的旧 ID；新建模板后再 batch 换绑到该商品。保存时会清空旧的模板 ID/名称存储。"
        >
          <Input placeholder="打开活动确认页后通常会自动出现" inputMode="numeric" />
        </Form.Item>
      </Form>
      <Space style={{ marginTop: 8 }} wrap>
        <Button type="primary" onClick={onSave} loading={loading}>
          保存到本地
        </Button>
        <Button
          onClick={() => {
            void chrome.storage.local.remove(STORAGE_ACTIVITY_DEBUG_LOGS, () => {
              if (chrome.runtime.lastError) {
                void message.error(chrome.runtime.lastError.message);
                return;
              }
              setDebugLogs([]);
              void message.success('已清空调试日志');
            });
          }}
        >
          清空调试日志
        </Button>
        <Button
          onClick={() => {
            load();
            setTimeout(() => tryAutofillGoodsIdFromPage(), 0);
          }}
        >
          刷新
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          日志来自商家后台页注入脚本；请先打开 mms 活动确认页再点刷新以尝试自动填 ID。
        </Typography.Text>
      </Space>
      {prepareHint ? (
        <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0 }}>
          {prepareHint}
        </Typography.Paragraph>
      ) : null}

      <Card
        size="small"
        title="调试日志（最近 200 条）"
        style={{ marginTop: 16 }}
        styles={{ body: { padding: 8 } }}
      >
        {debugLogs.length === 0 ? (
          <Typography.Text type="secondary">暂无日志。启用助手并在后台触发 enrollV2 后会在此出现。</Typography.Text>
        ) : (
          <pre
            style={{
              margin: 0,
              maxHeight: 280,
              overflow: 'auto',
              fontSize: 11,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'ui-monospace, Consolas, monospace',
            }}
          >
            {debugLogs.map((p) => formatDebugLine(p)).join('\n\n')}
          </pre>
        )}
      </Card>
    </div>
  );
}
