/**
 * Priority Configuration — Single source of truth
 * Used across all screens for consistent priority colors, labels, and sorting.
 */

export const PRIORITY_LEVELS = {
  URGENT: 3,
  HIGH: 2,
  NORMAL: 1,
  LOW: 0,
};

export const PRIORITY_CONFIG = {
  [PRIORITY_LEVELS.URGENT]: {
    label: 'Urgent',
    color: '#FB7185',
    sortWeight: 3,
  },
  [PRIORITY_LEVELS.HIGH]: {
    label: 'High',
    color: '#FBBF24',
    sortWeight: 2,
  },
  [PRIORITY_LEVELS.NORMAL]: {
    label: 'Normal',
    color: '#60A5FA',
    sortWeight: 1,
  },
  [PRIORITY_LEVELS.LOW]: {
    label: 'Low',
    color: '#34D399',
    sortWeight: 0,
  },
};

/** Get color for a given priority value. Defaults to Normal grey. */
export const getPriorityColor = (priority) => {
  return PRIORITY_CONFIG[priority]?.color || PRIORITY_CONFIG[PRIORITY_LEVELS.NORMAL].color;
};

/** Get label for a given priority value. Defaults to 'Normal'. */
export const getPriorityLabel = (priority) => {
  return PRIORITY_CONFIG[priority]?.label || 'Normal';
};

export const shouldShowFlag = (priority) => {
  return priority !== undefined && priority !== null;
};
