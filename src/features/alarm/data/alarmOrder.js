/**
 * Merge a drag result for the visible rows back into the complete alarm list.
 * Hidden/filtered alarms keep their slots while every row receives a durable,
 * contiguous order_index. Pure and side-effect free for focused validation.
 */
export const mergeVisibleAlarmOrder = (fullAlarms = [], visibleAlarms = []) => {
  const full = Array.isArray(fullAlarms) ? fullAlarms.filter(Boolean) : [];
  const previousById = new Map(full.map((alarm) => [alarm.id, alarm]));
  const originalPosition = new Map(full.map((alarm, index) => [alarm.id, index]));
  const previousFullOrder = [...full].sort((a, b) => {
    const aPosition = originalPosition.get(a.id);
    const bPosition = originalPosition.get(b.id);
    const aOrder = Number.isFinite(a.order_index) ? a.order_index : aPosition;
    const bOrder = Number.isFinite(b.order_index) ? b.order_index : bPosition;
    return aOrder - bOrder || aPosition - bPosition;
  });

  const seen = new Set();
  const visible = (Array.isArray(visibleAlarms) ? visibleAlarms : []).filter((alarm) => {
    if (!alarm?.id || !previousById.has(alarm.id) || seen.has(alarm.id)) return false;
    seen.add(alarm.id);
    return true;
  });
  let visibleIndex = 0;
  const reorderedFull = previousFullOrder.map((alarm) =>
    seen.has(alarm.id) ? visible[visibleIndex++] : alarm,
  );
  const merged = reorderedFull.map((alarm, index) => ({
    ...previousById.get(alarm.id),
    ...alarm,
    order_index: index,
  }));
  const changed = merged.filter((alarm) =>
    previousById.get(alarm.id)?.order_index !== alarm.order_index,
  );

  return { merged, changed };
};