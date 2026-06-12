import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { Storage } from '../utils/storage';

/**
 * Today's Tasks Widget
 * Shows first 5 uncompleted tasks from Today screen
 * Updates every 15 minutes
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
    
    // Filter today's tasks (same logic as TodayScreen)
    const todayStr = new Date().toDateString();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const todayTasks = allTasks.filter(t => {
      // Skip completed tasks
      if (t.is_completed) return false;
      
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

    // Sort by order_index (custom sort)
    todayTasks.sort((a, b) => {
      const indexA = a.order_index ?? Infinity;
      const indexB = b.order_index ?? Infinity;
      return indexA - indexB || new Date(b.created_at) - new Date(a.created_at);
    });

    // Show max 5 tasks
    const displayTasks = todayTasks.slice(0, 5);
    const hasMore = todayTasks.length > 5;

    return (
      <FlexWidget
        style={{
          height: 'match_parent',
          width: 'match_parent',
          backgroundColor: '#000000',
          borderRadius: 12,
          padding: 16,
        }}
        clickAction="OPEN_APP"
        clickActionData={{ screen: 'Today' }}
      >
        {/* Header - matching LifePilot's "YOUR TASKS" style */}
        <FlexWidget
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: '#222222',
          }}
        >
          <TextWidget
            text="TODAY"
            style={{
              fontSize: 13,
              color: '#666666',
              fontWeight: 'bold',
              letterSpacing: 1.5,
            }}
          />
          <TextWidget
            text={`${todayTasks.length}`}
            style={{
              fontSize: 24,
              color: '#FFFFFF',
              fontWeight: 'bold',
            }}
          />
        </FlexWidget>

        {/* Task List or Empty State */}
        {displayTasks.length === 0 ? (
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
                color: '#555555',
                fontStyle: 'italic',
              }}
            />
          </FlexWidget>
        ) : (
          <FlexWidget style={{ flex: 1 }}>
            {displayTasks.map((task, index) => {
              const isOverdue = task.due_date && new Date(task.due_date) < todayStart;
              
              return (
                <FlexWidget
                  key={task.id}
                  clickAction="OPEN_APP"
                  clickActionData={{ screen: 'TaskDetail', taskId: task.id }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginBottom: index < displayTasks.length - 1 ? 16 : 0,
                    paddingVertical: 4,
                  }}
                >
                  {/* Checkbox - minimal circle like Dashboard */}
                  <TextWidget
                    text="○"
                    style={{
                      fontSize: 18,
                      color: '#FFFFFF',
                      marginRight: 16,
                      width: 18,
                    }}
                  />
                  
                  {/* Task Title - clean typography */}
                  <FlexWidget style={{ flex: 1 }}>
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
                    
                    {/* Overdue indicator below title if needed */}
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
            
            {/* "X more" text at bottom */}
            {hasMore && (
              <TextWidget
                text={`+ ${todayTasks.length - 5} more`}
                style={{
                  fontSize: 11,
                  color: '#555555',
                  textAlign: 'center',
                  marginTop: 12,
                  fontStyle: 'italic',
                }}
              />
            )}
          </FlexWidget>
        )}

        {/* Footer - minimal timestamp */}
        <TextWidget
          text={new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          style={{
            fontSize: 10,
            color: '#333333',
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
          color: '#888888',
          textAlign: 'center',
        }}
      />
    </FlexWidget>
  );
}
