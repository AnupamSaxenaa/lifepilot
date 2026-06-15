import { FlexWidget, ListWidget, TextWidget } from 'react-native-android-widget';
import { Storage } from '../utils/storage';

/**
 * Today's Tasks Widget
 * Shows uncompleted tasks from Today screen
 * Updates every 15 minutes, supports background completion
 */
export async function TodayTasksWidget(props) {
  try {
    // Load current user ID (saved on login)
    const userId = await Storage.get('current_user_id');
    
    if (!userId) {
      return <EmptyStateWidget message="Please log in to see tasks" />;
    }

    // Load tasks from AsyncStorage (instant, no network)
    const allTasks = await Storage.get(`tasks_${userId}`) || [];
    
    // Load lists to resolve list names for tags
    const allLists = await Storage.get(`lists_${userId}`) || [];
    const listMap = {};
    allLists.forEach(l => listMap[l.id] = l.name);
    
    // Filter today's tasks (same logic as TodayScreen)
    const todayStr = new Date().toDateString();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const todayTasks = allTasks.filter(t => {
      // Explicitly added to today
      if (t.added_to_today) return true;
      
      // Has due date for today or overdue
      if (t.due_date) {
        const dueDate = new Date(t.due_date);
        if (dueDate < todayStart || dueDate.toDateString() === todayStr) return true;
      }
      
      // Has reminder for today or past
      if (t.reminder_time) {
        const reminderDate = new Date(t.reminder_time);
        if (reminderDate < todayStart || reminderDate.toDateString() === todayStr) return true;
      }
      
      // Default tasks (no list, no dates) belong to Today
      if (!t.list_id && !t.due_date && !t.reminder_time) return true;
      
      return false;
    });

    // Separate active and completed tasks
    const activeTasks = todayTasks.filter(t => !t.is_completed);
    const completedTasks = todayTasks.filter(t => t.is_completed);

    // Sort by order_index (custom sort)
    activeTasks.sort((a, b) => {
      const indexA = a.order_index ?? Infinity;
      const indexB = b.order_index ?? Infinity;
      return indexA - indexB || new Date(b.created_at) - new Date(a.created_at);
    });

    // Sort completed by completion time (most recent first)
    completedTasks.sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0));

    // Support up to 50 tasks total (active + completed)
    const displayActiveTasks = activeTasks.slice(0, 40);
    const displayCompletedTasks = completedTasks.slice(0, 10);

    const { width, height } = props.widgetInfo || {};

    return (
      <FlexWidget
        style={{
          height: height || 'match_parent',
          width: width || 'match_parent',
          backgroundColor: '#000000',
          borderRadius: 16,
          padding: 16,
        }}
        clickAction="OPEN_APP"
        clickActionData={{ screen: 'Today' }}
      >
        {/* Header */}
        <FlexWidget
          style={{
            flexDirection: 'row',
            marginBottom: 16,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: '#444444',
          }}
        >
          <FlexWidget style={{ flex: 1, justifyContent: 'center' }}>
            <TextWidget
              text="TODAY"
              style={{
                fontSize: 13,
                color: '#BBBBBB',
                fontWeight: 'bold',
                letterSpacing: 1.5,
              }}
            />
          </FlexWidget>
          <FlexWidget style={{ justifyContent: 'center', alignItems: 'flex-end' }}>
            <TextWidget
              text={`${activeTasks.length}`}
              style={{
                fontSize: 24,
                color: '#FFFFFF',
                fontWeight: 'bold',
              }}
            />
          </FlexWidget>
        </FlexWidget>

          {/* Task List or Empty State */}
          {displayActiveTasks.length === 0 && displayCompletedTasks.length === 0 ? (
            <FlexWidget
              style={{
                flex: 1,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <TextWidget
                text="All caught up"
                style={{
                  fontSize: 18,
                  color: '#FFFFFF',
                  fontWeight: '600',
                  marginBottom: 8,
                }}
              />
              <TextWidget
                text="No tasks for today"
                style={{
                  fontSize: 14,
                  color: '#999999',
                  fontStyle: 'italic',
                }}
              />
            </FlexWidget>
          ) : (
            <ListWidget style={{ flex: 1 }}>
              {/* Active Tasks */}
              {displayActiveTasks.map((task, index) => {
                const isOverdue = task.due_date && new Date(task.due_date) < todayStart;
                
                const tags = [];
                if (!isOverdue && task.due_date) tags.push(new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
                if (task.reminder_time) tags.push(new Date(task.reminder_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
                if (task.repeat_rule) tags.push(task.repeat_rule);
                if (task.subtasks && task.subtasks.length > 0) {
                  const comp = task.subtasks.filter(s => s.is_completed).length;
                  tags.push(`${comp}/${task.subtasks.length} steps`);
                }
                if (task.list_id && listMap[task.list_id]) {
                  tags.push(listMap[task.list_id]);
                }
                const tagsString = tags.join(' • ');

                return (
                  <FlexWidget
                    key={task.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      marginBottom: 16,
                      paddingVertical: 4,
                    }}
                  >
                    {/* Checkbox - clickable with immediate visual feedback */}
                    <FlexWidget
                      clickAction="CUSTOM_ACTION"
                      clickActionData={{ action: 'TOGGLE_TASK', taskId: task.id, currentStatus: task.is_completed ? 'true' : 'false' }}
                      style={{
                        paddingRight: 16,
                        justifyContent: 'center',
                        alignItems: 'center',
                        width: 32,
                        height: 32,
                      }}
                    >
                      <TextWidget
                        text="○"
                        style={{
                          fontSize: 22,
                          color: '#FFFFFF',
                          fontWeight: '300',
                        }}
                      />
                    </FlexWidget>
                    
                    {/* Task Title - opens the app to TaskDetail */}
                    <FlexWidget 
                      style={{ flex: 1 }}
                      clickAction="OPEN_APP"
                      clickActionData={{ screen: 'TaskDetail', taskId: task.id }}
                    >
                      <TextWidget
                        text={task.title}
                        style={{
                          fontSize: 16,
                          color: '#FFFFFF',
                          fontWeight: '400',
                          lineHeight: 22,
                        }}
                        maxLines={2}
                      />
                      
                      {/* Overdue indicator */}
                      {isOverdue && (
                        <TextWidget
                          text="OVERDUE"
                          style={{
                            fontSize: 10,
                            color: '#EF4444',
                            fontWeight: '700',
                            letterSpacing: 0.5,
                            marginTop: 4,
                          }}
                        />
                      )}
                      
                      {/* Meta Tags */}
                      {tagsString.length > 0 && (
                        <TextWidget
                           text={tagsString}
                           style={{
                             fontSize: 11,
                             color: '#A1A1AA',
                             marginTop: isOverdue ? 2 : 4,
                           }}
                           maxLines={1}
                         />
                      )}
                    </FlexWidget>
                    
                    {/* Star for important tasks */}
                    {task.is_important && (
                      <TextWidget
                        text="⭐"
                        style={{
                          fontSize: 14,
                          marginLeft: 8,
                        }}
                      />
                    )}
                  </FlexWidget>
                );
              })}
              
              {/* Completed Tasks Section */}
              {displayCompletedTasks.length > 0 && (
                <FlexWidget style={{ width: 'match_parent' }}>
                  <FlexWidget
                    style={{
                      marginTop: 24,
                      marginBottom: 16,
                      paddingTop: 12,
                      borderTopWidth: 1,
                      borderTopColor: '#333333',
                    }}
                  >
                    <TextWidget
                      text={`COMPLETED (${completedTasks.length})`}
                      style={{
                        fontSize: 11,
                        color: '#666666',
                        fontWeight: 'bold',
                        letterSpacing: 1.2,
                      }}
                    />
                  </FlexWidget>
                  
                  {displayCompletedTasks.map((task, index) => {
                    const tags = [];
                    if (task.due_date) tags.push(new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
                    if (task.list_id && listMap[task.list_id]) {
                      tags.push(listMap[task.list_id]);
                    }
                    const tagsString = tags.join(' • ');

                    return (
                      <FlexWidget
                        key={task.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          marginBottom: 12,
                          paddingVertical: 2,
                        }}
                      >
                        {/* Checkmark for completed */}
                        <FlexWidget
                          clickAction="CUSTOM_ACTION"
                          clickActionData={{ action: 'TOGGLE_TASK', taskId: task.id, currentStatus: 'true' }}
                          style={{
                            paddingRight: 16,
                            justifyContent: 'center',
                            alignItems: 'center',
                            width: 32,
                            height: 32,
                          }}
                        >
                          <TextWidget
                            text="✓"
                            style={{
                              fontSize: 18,
                              color: '#10B981',
                              fontWeight: 'bold',
                            }}
                          />
                        </FlexWidget>
                        
                        {/* Task Title with strikethrough effect (via gray color) */}
                        <FlexWidget 
                          style={{ flex: 1 }}
                          clickAction="OPEN_APP"
                          clickActionData={{ screen: 'TaskDetail', taskId: task.id }}
                        >
                          <TextWidget
                            text={task.title}
                            style={{
                              fontSize: 15,
                              color: '#666666',
                              fontWeight: '400',
                              lineHeight: 20,
                            }}
                            maxLines={1}
                          />
                          
                          {/* Tags for completed tasks */}
                          {tagsString.length > 0 && (
                            <TextWidget
                               text={tagsString}
                               style={{
                                 fontSize: 10,
                                 color: '#555555',
                                 marginTop: 2,
                               }}
                               maxLines={1}
                             />
                          )}
                        </FlexWidget>
                      </FlexWidget>
                    );
                  })}
                </FlexWidget>
              )}
            </ListWidget>
          )}

          {/* Footer - minimal timestamp */}
          <TextWidget
            text={new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            style={{
              fontSize: 10,
              color: '#999999',
              textAlign: 'right',
              marginTop: 12,
            }}
          />
        </FlexWidget>
    );
  } catch (error) {
    console.error('Widget error:', error);
    return <EmptyStateWidget message="Failed to load tasks" />;
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
        borderRadius: 16,
        padding: 16,
        justifyContent: 'center',
        alignItems: 'center',
      }}
      clickAction="OPEN_APP"
    >
        <TextWidget
          text="LifePilot"
          style={{
            fontSize: 16,
            color: '#FFFFFF',
            fontWeight: 'bold',
            marginBottom: 8,
          }}
        />
        <TextWidget
          text={message}
          style={{
            fontSize: 13,
            color: '#DDDDDD',
            textAlign: 'center',
          }}
        />
      </FlexWidget>
  );
}
