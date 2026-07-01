import { FlexWidget, ListWidget, TextWidget, SvgWidget } from 'react-native-android-widget';
import { Storage } from '../utils/storage';

/**
 * Today's Tasks Widget - Clean Minimal Design
 * Matches LifePilot's Dashboard/Today screen aesthetic
 */
export async function TodayTasksWidget(props) {
  try {
    const userId = await Storage.get('current_user_id');
    
    if (!userId) {
      return <EmptyStateWidget message="Log in to see tasks" />;
    }

    const allTasks = await Storage.get(`tasks_${userId}`) || [];
    
    // Settings
    const opacityVal = parseInt(await Storage.get('widget_bg_opacity') || '100', 10);
    const hideCompleted = (await Storage.get('widget_hide_completed')) === 'true';
    
    // Pure black background with opacity
    const opacityHex = Math.round((opacityVal / 100) * 255).toString(16).padStart(2, '0').toUpperCase();
    const bgColor = `#000000${opacityHex}`;
    
    // Load lists for task tags
    const allLists = await Storage.get(`lists_${userId}`) || [];
    const listMap = {};
    allLists.forEach(l => listMap[l.id] = l.name);
    
    // Responsive sizing
    const { height } = props.widgetInfo || {};
    const isLarge = height >= 400;
    const isMedium = height >= 250 && height < 400;
    const isSmall = height < 250;
    
    const padding = 16;
    const headerSize = 12;
    const taskSize = 14;
    const tagSize = 10;
    const maxTasks = isLarge ? 12 : isMedium ? 8 : 4;

    const starSvg = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
      </svg>
    `;

    // Filter today's tasks
    const todayStr = new Date().toDateString();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const isTaskForToday = (t) => {
      if (t.added_to_today) return true;
      if (t.due_date) {
        const dueDate = new Date(t.due_date);
        if (dueDate < todayStart || dueDate.toDateString() === todayStr) return true;
      }
      if (t.reminder_time) {
        const reminderDate = new Date(t.reminder_time);
        if (reminderDate < todayStart || reminderDate.toDateString() === todayStr) return true;
      }
      if (!t.list_id && !t.due_date && !t.reminder_time) return true;
      return false;
    };

    // Active tasks
    const activeTasks = allTasks
      .filter(t => isTaskForToday(t) && !t.is_completed)
      .sort((a, b) => {
        const ia = a.order_index ?? Infinity;
        const ib = b.order_index ?? Infinity;
        return ia - ib || new Date(b.created_at) - new Date(a.created_at);
      })
      .slice(0, maxTasks);

    // Completed tasks (only if not hidden)
    const completedTasks = (!hideCompleted)
      ? allTasks
          .filter(t => {
            if (!t.is_completed || !isTaskForToday(t)) return false;
            const completedDate = t.completed_at ? new Date(t.completed_at).toDateString() : null;
            return completedDate === todayStr;
          })
          .sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0))
          .slice(0, 5)
      : [];

    return (
      <FlexWidget
        style={{
          height: 'match_parent',
          width: 'match_parent',
          backgroundColor: bgColor,
          borderRadius: 20,
          padding: padding,
        }}
        clickAction="OPEN_APP"
      >
        {/* Header */}
        <FlexWidget
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TextWidget
              text="TODAY"
              style={{
                fontSize: headerSize,
                color: '#FAFAFA',
                fontWeight: '700',
                letterSpacing: 2,
                marginRight: 12,
              }}
            />
            <TextWidget
              text={`${activeTasks.length}`}
              style={{
                fontSize: headerSize + 6,
                color: '#FAFAFA',
                fontWeight: '700',
              }}
            />
          </FlexWidget>
          
          {/* Header Actions */}
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* Add Task Plus Icon */}
            <FlexWidget
              clickAction="OPEN_URI"
              clickActionData={{ uri: 'lifepilot-alpha://today' }}
              style={{
                width: 28,
                height: 28,
                justifyContent: 'center',
                alignItems: 'center',
                marginRight: 8,
              }}
            >
              <TextWidget
                text="+"
                style={{
                  fontSize: 24,
                  color: '#FAFAFA',
                  fontWeight: '300',
                  marginTop: -2,
                }}
              />
            </FlexWidget>

            {/* Settings Gear - Opens app for settings */}
            <FlexWidget
              clickAction="OPEN_URI"
              clickActionData={{ uri: 'lifepilot-alpha://widget-settings' }}
              style={{
                width: 28,
                height: 28,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <TextWidget
                text="⚙"
                style={{
                  fontSize: 16,
                  color: '#52525B',
                }}
              />
            </FlexWidget>
          </FlexWidget>
        </FlexWidget>

        {/* Divider */}
        <FlexWidget
          style={{
            height: 1,
            width: 'match_parent',
            backgroundColor: '#1C1C1E',
            marginBottom: 16,
          }}
        />

        {/* Task List */}
        {activeTasks.length === 0 && completedTasks.length === 0 ? (
          <FlexWidget
            style={{
              flex: 1,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <TextWidget
              text="✓"
              style={{
                fontSize: 32,
                color: '#27272A',
                marginBottom: 8,
              }}
            />
            <TextWidget
              text="All done for today"
              style={{
                fontSize: taskSize,
                color: '#52525B',
                fontWeight: '500',
              }}
            />
          </FlexWidget>
        ) : (
          <ListWidget style={{ flex: 1 }}>
            {/* Active Tasks */}
            {activeTasks.map((task, index) => {
              const isOverdue = task.due_date && new Date(task.due_date) < todayStart;
              
              // Build tags
              const tags = [];
              if (task.due_date) {
                const dueDate = new Date(task.due_date);
                tags.push(dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
              }
              if (task.reminder_time) {
                const reminderDate = new Date(task.reminder_time);
                tags.push(reminderDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
              }
              if (task.repeat_rule) {
                tags.push(task.repeat_rule);
              }
              if (task.subtasks && task.subtasks.length > 0) {
                const comp = task.subtasks.filter(s => s.is_completed).length;
                tags.push(`${comp}/${task.subtasks.length}`);
              }
              if (task.list_id && listMap[task.list_id]) {
                tags.push(listMap[task.list_id]);
              }
              const tagsString = tags.join(' · ');

              return (
                <FlexWidget
                  key={task.id}
                  style={{
                    marginBottom: 0,
                  }}
                >
                  <FlexWidget
                    style={{
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      paddingVertical: 8,
                    }}
                  >
                    {/* Checkbox */}
                    <FlexWidget
                      clickAction="CUSTOM_ACTION"
                      clickActionData={{ action: 'TOGGLE_TASK', taskId: task.id, currentStatus: 'false' }}
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 8,
                        borderWidth: 2,
                        borderColor: '#FAFAFA',
                        marginRight: 12,
                        marginTop: 2,
                      }}
                    />
                    
                    {/* Task Content */}
                    <FlexWidget 
                      style={{ flex: 1 }}
                      clickAction="OPEN_APP"
                      clickActionData={{ screen: 'TaskDetail', taskId: task.id }}
                    >
                      {/* Task Title */}
                      <TextWidget
                        text={task.title}
                        style={{
                          fontSize: taskSize,
                          color: '#FAFAFA',
                          fontWeight: '400',
                          lineHeight: taskSize + 4,
                          marginBottom: tagsString ? 2 : 0,
                        }}
                        maxLines={2}
                      />
                      
                      {/* Tags */}
                      {tagsString.length > 0 && (
                        <TextWidget
                          text={tagsString}
                          style={{
                            fontSize: tagSize,
                            color: '#A1A1AA',
                            fontWeight: '400',
                            marginTop: 2,
                          }}
                          maxLines={1}
                        />
                      )}
                    </FlexWidget>
                    
                    {/* Right side icons */}
                    <FlexWidget
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: taskSize + 4,
                        marginLeft: 8,
                      }}
                    >
                      {task.is_important && (
                        <SvgWidget
                          svg={starSvg}
                          style={{
                            width: 14,
                            height: 14,
                            marginRight: 6,
                          }}
                        />
                      )}
                      <FlexWidget
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: task.priority === 3 ? '#EF4444' : task.priority === 2 ? '#F59E0B' : task.priority === 0 ? '#10B981' : '#6B7280',
                        }}
                      />
                    </FlexWidget>
                  </FlexWidget>
                  
                  {/* Timeline Divider */}
                  {index < activeTasks.length - 1 && (
                    <FlexWidget
                      style={{
                        height: 1,
                        width: 'match_parent',
                        backgroundColor: '#0A0A0A',
                      }}
                    />
                  )}
                </FlexWidget>
              );
            })}
            
            {/* Completed Tasks Section */}
            {completedTasks.length > 0 && (
              <FlexWidget style={{ marginTop: activeTasks.length > 0 ? 16 : 0 }}>
                {/* Section Divider */}
                <FlexWidget
                  style={{
                    height: 1,
                    width: 'match_parent',
                    backgroundColor: '#1C1C1E',
                    marginBottom: 16,
                  }}
                />
                
                <TextWidget
                  text={`COMPLETED (${completedTasks.length})`}
                  style={{
                    fontSize: 11,
                    color: '#666666',
                    fontWeight: 'bold',
                    letterSpacing: 1.2,
                    marginBottom: 16,
                  }}
                />
                
                {/* Completed Tasks */}
                {completedTasks.map((task, index) => (
                  <FlexWidget
                    key={task.id}
                    style={{
                      marginBottom: index < completedTasks.length - 1 ? 10 : 0,
                      opacity: 0.7,
                    }}
                  >
                    <FlexWidget
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                      }}
                    >
                      {/* Checkmark */}
                      <FlexWidget
                        clickAction="CUSTOM_ACTION"
                        clickActionData={{ action: 'TOGGLE_TASK', taskId: task.id, currentStatus: 'true' }}
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 8,
                          backgroundColor: '#10B981',
                          marginRight: 12,
                          justifyContent: 'center',
                          alignItems: 'center',
                        }}
                      >
                        <TextWidget
                          text="✓"
                          style={{
                            fontSize: 10,
                            color: '#000000',
                            fontWeight: '700',
                          }}
                        />
                      </FlexWidget>
                      
                      {/* Task Content */}
                      <FlexWidget style={{ flex: 1 }}>
                        <TextWidget
                          text={task.title}
                          style={{
                            fontSize: taskSize - 1,
                            color: '#9CA3AF',
                            fontWeight: '400',
                            textDecorationLine: 'line-through',
                          }}
                          maxLines={1}
                        />
                      </FlexWidget>
                      
                      {/* Right side icons */}
                      <FlexWidget
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: taskSize + 4,
                          marginLeft: 8,
                        }}
                      >
                        {task.is_important && (
                          <SvgWidget
                            svg={starSvg}
                            style={{
                              width: 14,
                              height: 14,
                              marginRight: 6,
                            }}
                          />
                        )}
                        <FlexWidget
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: task.priority === 3 ? '#EF4444' : task.priority === 2 ? '#F59E0B' : task.priority === 0 ? '#10B981' : '#6B7280',
                          }}
                        />
                      </FlexWidget>
                    </FlexWidget>
                  </FlexWidget>
                ))}
              </FlexWidget>
            )}
          </ListWidget>
        )}
      </FlexWidget>
    );
  } catch (error) {
    console.error('[Widget] Error:', error);
    return <EmptyStateWidget message="Error loading tasks" />;
  }
}

// Empty state component
function EmptyStateWidget({ message }) {
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: '#000000',
        borderRadius: 20,
        padding: 24,
        justifyContent: 'center',
        alignItems: 'center',
      }}
      clickAction="OPEN_APP"
    >
      <TextWidget
        text="LifePilot"
        style={{
          fontSize: 18,
          color: '#FAFAFA',
          fontWeight: '700',
          marginBottom: 8,
          letterSpacing: 1,
        }}
      />
      <TextWidget
        text={message}
        style={{
          fontSize: 13,
          color: '#52525B',
          textAlign: 'center',
          fontWeight: '400',
        }}
      />
    </FlexWidget>
  );
}
