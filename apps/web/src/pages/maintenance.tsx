import { useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Wrench, X } from 'lucide-react';
import type { Equipment, Page, WorkOrder, WorkOrderStatus, Priority } from '@plantops/contracts';
import { api, RefreshContext, usePoll } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Empty, ErrorBanner, Loading, PageHeading, Panel } from '@/components/common';
const statuses: Record<WorkOrderStatus, string> = {
  OPEN: 'Открыта',
  IN_PROGRESS: 'В работе',
  COMPLETED: 'Выполнена',
  CANCELLED: 'Отменена',
};
const priorities: Record<Priority, string> = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  URGENT: 'Срочный',
};
const date = (s: string) => new Date(s).toLocaleString('ru-RU');
type Draft = {
  equipmentId: string;
  title: string;
  description: string;
  assignee: string;
  priority: Priority;
};
const initial: Draft = {
  equipmentId: 'H-101',
  title: '',
  description: '',
  assignee: 'Оператор демо',
  priority: 'MEDIUM',
};
function Fields({
  draft,
  setDraft,
  equipment,
  edit = false,
}: {
  draft: Draft;
  setDraft: (value: Draft) => void;
  equipment: Equipment[];
  edit?: boolean;
}) {
  return (
    <div className="order-fields">
      {!edit && (
        <label>
          Оборудование
          <select
            value={draft.equipmentId}
            onChange={(e) => setDraft({ ...draft, equipmentId: e.target.value })}
          >
            {equipment.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.description}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Название заявки
        <input
          required
          minLength={3}
          maxLength={120}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </label>
      <label>
        Описание проблемы
        <textarea
          required
          minLength={5}
          maxLength={2000}
          rows={3}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </label>
      <div className="form-row">
        <label>
          Приоритет
          <select
            value={draft.priority}
            onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}
          >
            {Object.entries(priorities).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ответственный
          <input
            required
            maxLength={80}
            value={draft.assignee}
            onChange={(e) => setDraft({ ...draft, assignee: e.target.value })}
          />
        </label>
      </div>
    </div>
  );
}
function CreateOrder({
  equipment,
  onClose,
  onCreated,
}: {
  equipment: Equipment[];
  onClose: () => void;
  onCreated: (order: WorkOrder) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [draft, setDraft] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onCreated(
        await api<WorkOrder>('/maintenance', { method: 'POST', body: JSON.stringify(draft) }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="order-dialog"
      aria-labelledby="create-order-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className="panel-head">
        <h2 id="create-order-title">Новая заявка</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Закрыть форму"
          disabled={busy}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <form onSubmit={submit}>
        <p className="form-hint">Достаточно названия роли — личные данные не требуются.</p>
        <Fields draft={draft} setDraft={setDraft} equipment={equipment} />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button disabled={busy}>{busy ? 'Создаём…' : 'Создать заявку'}</Button>
        </div>
      </form>
    </dialog>
  );
}
function OrderDetail({
  id,
  equipment,
  onClose,
}: {
  id: string;
  equipment: Equipment[];
  onClose: () => void;
}) {
  const result = usePoll<WorkOrder>(`/maintenance/${id}`),
    { refresh } = useContext(RefreshContext);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [comment, setComment] = useState(''),
    [resolution, setResolution] = useState(''),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(initial);
  const order = result.data,
    closed = order && ['COMPLETED', 'CANCELLED'].includes(order.status);
  async function change(path: string, method: string, body: object, done?: () => void) {
    setError('');
    setBusy(true);
    try {
      await api(path, { method, body: JSON.stringify(body) });
      done?.();
      refresh();
    } catch (e) {
      setError((e as Error).message);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  function transition(status: WorkOrderStatus) {
    if (!order) return;
    if (
      (status === 'COMPLETED' || status === 'CANCELLED') &&
      !window.confirm(`${statuses[status]}: подтвердить окончательное закрытие заявки?`)
    )
      return;
    void change(`/maintenance/${id}`, 'PATCH', { version: order.version, status, resolution });
  }
  return (
    <Panel
      title="Карточка заявки"
      actions={
        <Button variant="ghost" size="icon" aria-label="Закрыть карточку" onClick={onClose}>
          <X />
        </Button>
      }
    >
      <div className="order-detail">
        <ErrorBanner error={result.error} />
        {!order ? (
          <Loading />
        ) : (
          <>
            <div className="order-meta">
              <span className={`status ${order.status.toLowerCase()}`}>
                {statuses[order.status]}
              </span>
              <span className={`priority ${order.priority.toLowerCase()}`}>
                {priorities[order.priority]}
              </span>
              <code>№ {order.id.slice(0, 8)}</code>
            </div>
            <h3>{order.title}</h3>
            <Link to={`/equipment/${order.equipmentId}`}>
              {equipment.find((e) => e.id === order.equipmentId)?.name ?? order.equipmentId} ·
              Карточка оборудования →
            </Link>
            <p className="user-text">{order.description}</p>
            <dl className="order-facts">
              <div>
                <dt>Ответственный</dt>
                <dd>{order.assignee}</dd>
              </div>
              <div>
                <dt>Создана</dt>
                <dd>{date(order.createdAt)}</dd>
              </div>
              <div>
                <dt>Обновлена</dt>
                <dd>
                  {date(order.updatedAt)} · v{order.version}
                </dd>
              </div>
            </dl>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {!closed && (
              <fieldset disabled={busy}>
                <div className="form-actions">
                  {order.status === 'OPEN' && (
                    <Button onClick={() => transition('IN_PROGRESS')}>Взять в работу</Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDraft(order);
                      setEditing(!editing);
                    }}
                  >
                    Редактировать
                  </Button>
                </div>
                {editing && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const { equipmentId: _id, ...changes } = draft;
                      void change(
                        `/maintenance/${id}`,
                        'PATCH',
                        { ...changes, version: order.version },
                        () => setEditing(false),
                      );
                    }}
                  >
                    <Fields draft={draft} setDraft={setDraft} equipment={equipment} edit />
                    <Button>Сохранить изменения</Button>
                  </form>
                )}
                <label className="order-label">
                  Результат работ / причина отмены
                  <textarea
                    rows={2}
                    minLength={5}
                    maxLength={2000}
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    placeholder="Опишите результат — минимум 5 символов"
                  />
                </label>
                <p className="form-hint">
                  Выполнение доступно из статуса «В работе», когда оборудование в норме. Закрытые
                  заявки нельзя редактировать.
                </p>
                <div className="form-actions">
                  {order.status === 'IN_PROGRESS' && (
                    <Button
                      disabled={resolution.trim().length < 5}
                      onClick={() => transition('COMPLETED')}
                    >
                      Завершить заявку
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    disabled={resolution.trim().length < 5}
                    onClick={() => transition('CANCELLED')}
                  >
                    Отменить заявку
                  </Button>
                </div>
              </fieldset>
            )}
            {closed && (
              <>
                <div className="info-strip user-text">{order.resolution}</div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Скрыть закрытую заявку из реестра? История останется в хранилище.',
                      )
                    )
                      void change(
                        `/maintenance/${id}`,
                        'DELETE',
                        { version: order.version },
                        onClose,
                      );
                  }}
                >
                  Архивировать
                </Button>
              </>
            )}
            <h4>Комментарии · {order.comments.length}</h4>
            {order.comments.length === 0 && <p className="form-hint">Комментариев пока нет.</p>}
            {order.comments.map((c) => (
              <article className="order-comment" key={c.id}>
                <strong>{c.author}</strong>
                <time>{date(c.createdAt)}</time>
                <p className="user-text">{c.text}</p>
              </article>
            ))}
            {!closed && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void change(
                    `/maintenance/${id}/comments`,
                    'POST',
                    { version: order.version, author: 'Оператор демо', text: comment },
                    () => setComment(''),
                  );
                }}
              >
                <label className="order-label">
                  Новый комментарий
                  <textarea
                    required
                    maxLength={1000}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </label>
                <Button disabled={busy || !comment.trim()} variant="outline">
                  Добавить комментарий
                </Button>
              </form>
            )}
            <h4>История изменений</h4>
            <ol className="order-history">
              {[...order.history].reverse().map((h) => (
                <li key={h.id}>
                  <time>{date(h.createdAt)}</time>
                  <p>{h.detail}</p>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </Panel>
  );
}
export function MaintenancePage() {
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [priority, setPriority] = useState(''),
    [equipmentId, setEquipmentId] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(''),
    [creating, setCreating] = useState(false);
  const { refresh } = useContext(RefreshContext),
    equipment = usePoll<Equipment[]>('/equipment');
  const params = new URLSearchParams({ search, page: String(page), pageSize: '10' });
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);
  if (equipmentId) params.set('equipmentId', equipmentId);
  const orders = usePoll<Page<WorkOrder>>(`/maintenance?${params}`);
  function filter(set: (s: string) => void, value: string) {
    set(value);
    setPage(1);
  }
  return (
    <>
      <PageHeading
        title="Техническое обслуживание"
        description="Планируйте работы, назначайте ответственных и сохраняйте историю решений."
        actions={
          <Button onClick={() => setCreating(true)} disabled={!equipment.data}>
            <Plus />
            Новая заявка
          </Button>
        }
      />
      <ErrorBanner error={orders.error ?? equipment.error} />
      <div className="filter-bar maintenance-filters">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Поиск заявок"
            placeholder="Название, описание, ответственный"
            value={search}
            maxLength={100}
            onChange={(e) => filter(setSearch, e.target.value)}
          />
        </label>
        <select
          aria-label="Статус заявки"
          value={status}
          onChange={(e) => filter(setStatus, e.target.value)}
        >
          <option value="">Все статусы</option>
          {Object.entries(statuses).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="Приоритет заявки"
          value={priority}
          onChange={(e) => filter(setPriority, e.target.value)}
        >
          <option value="">Все приоритеты</option>
          {Object.entries(priorities).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="Оборудование заявки"
          value={equipmentId}
          onChange={(e) => filter(setEquipmentId, e.target.value)}
        >
          <option value="">Всё оборудование</option>
          {equipment.data?.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>
      <div className={`maintenance-layout ${selected ? 'with-detail' : ''}`}>
        <Panel
          title="Реестр заявок"
          actions={<span className="count-label">{orders.data?.total ?? 0} заявок</span>}
        >
          {orders.loading ? (
            <Loading />
          ) : orders.data?.items.length ? (
            <>
              <div className="order-list">
                {orders.data.items.map((o) => (
                  <button
                    className={`order-row ${selected === o.id ? 'selected' : ''}`}
                    key={o.id}
                    onClick={() => setSelected(o.id)}
                    aria-pressed={selected === o.id}
                  >
                    <Wrench size={20} />
                    <div>
                      <strong>{o.title}</strong>
                      <span>
                        {equipment.data?.find((e) => e.id === o.equipmentId)?.name ?? o.equipmentId}{' '}
                        · {o.assignee}
                      </span>
                      <small>{date(o.updatedAt)}</small>
                    </div>
                    <div className="order-tags">
                      <span className={`status ${o.status.toLowerCase()}`}>
                        {statuses[o.status]}
                      </span>
                      <span className={`priority ${o.priority.toLowerCase()}`}>
                        {priorities[o.priority]}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="pagination">
                <span>Страница {page}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  Назад
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * 10 >= orders.data.total}
                  onClick={() => setPage(page + 1)}
                >
                  Далее
                </Button>
              </div>
            </>
          ) : (
            <Empty text="Заявок не найдено. Создайте заявку или измените фильтры." />
          )}
        </Panel>
        {selected && (
          <OrderDetail
            key={selected}
            id={selected}
            equipment={equipment.data ?? []}
            onClose={() => setSelected('')}
          />
        )}
      </div>
      {creating && (
        <CreateOrder
          equipment={equipment.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={(o) => {
            setCreating(false);
            setSelected(o.id);
            setPage(1);
            refresh();
          }}
        />
      )}
    </>
  );
}
