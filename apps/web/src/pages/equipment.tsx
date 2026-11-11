import { useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { Equipment as EquipmentType } from '@plantops/contracts';
import { usePoll } from '@/lib/api';
import { EquipmentTable } from '@/components/equipment-table';
import { ErrorBanner, Loading, PageHeading, Panel } from '@/components/common';
export function EquipmentPage() {
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('');
  const result = usePoll<EquipmentType[]>('/equipment');
  const filtered = result.data?.filter(
    (e) =>
      (!status || e.status === status) &&
      `${e.name} ${e.id} ${e.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        title="Оборудование"
        description="Текущее состояние и параметры производственного участка."
      />
      <ErrorBanner error={result.error} />
      <Panel
        title="Реестр оборудования"
        actions={
          <span className="count-label">
            {filtered?.length ?? 0} из {result.data?.length ?? 0} единиц
          </span>
        }
      >
        <div className="filter-bar">
          <label className="search">
            <Search size={17} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию или ID"
              aria-label="Поиск оборудования"
            />
          </label>
          <div className="filter-select">
            <SlidersHorizontal size={16} />
            <select
              aria-label="Состояние оборудования"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Все состояния</option>
              <option value="NORMAL">В норме</option>
              <option value="WARNING">Предупреждение</option>
              <option value="CRITICAL">Критическое</option>
            </select>
          </div>
        </div>
        {filtered ? <EquipmentTable items={filtered} /> : <Loading />}
      </Panel>
      <div className="info-strip">
        Учебный участок включает три насоса, компрессор и теплообменник. Резервный насос работает в
        демонстрационном режиме циркуляции.
      </div>
    </>
  );
}
