import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { Storage } from '../utils/storage';

/**
 * Stats Widget
 * Shows productivity stats: tasks done today, streak, level
 * Motivational and engaging
 */
export async function StatsWidget(props) {
  try {
    // Load current user ID
    const userId = await Storage.get('current_user_id');
    
    if (!userId) {
      return <EmptyStatsWidget />;
    }

    // Load gamification state
    const gamestate = await Storage.get(`gamestate_${userId}`) || {
      xp: 0,
      level: 1,
      streak: 0,
      tasksCompletedToday: 0,
    };
    
    // Load tasks to count today's completions
    const allTasks = await Storage.get(`tasks_${userId}`) || [];
    const todayStr = new Date().toDateString();
    const completedToday = allTasks.filter(t => 
      t.is_completed && 
      t.completed_at && 
      new Date(t.completed_at).toDateString() === todayStr
    ).length;

    return (
      <FlexWidget
        clickAction="OPEN_APP"
        clickActionData={{ screen: 'Dashboard' }}
        style={{
          height: 'match_parent',
          width: 'match_parent',
          backgroundColor: '#000000',
          borderRadius: 12,
          padding: 16,
        }}
      >
        {/* Header - matching LifePilot style */}
        <TextWidget
          text="STATS"
          style={{
            fontSize: 13,
            color: '#666666',
            fontWeight: 'bold',
            letterSpacing: 1.5,
            marginBottom: 20,
          }}
        />

        {/* Primary stat - big completion count */}
        <FlexWidget style={{ alignItems: 'flex-start', marginBottom: 24 }}>
          <TextWidget
            text={`${completedToday}`}
            style={{
              fontSize: 56,
              color: '#FFFFFF',
              fontWeight: 'bold',
              lineHeight: 56,
            }}
          />
          <TextWidget
            text="tasks done today"
            style={{
              fontSize: 14,
              color: '#555555',
              marginTop: 8,
            }}
          />
        </FlexWidget>

        {/* Secondary stats in row */}
        <FlexWidget 
          style={{ 
            flexDirection: 'row', 
            justifyContent: 'space-between',
            marginTop: 'auto',
          }}
        >
          {/* Streak */}
          <FlexWidget>
            <TextWidget
              text={`${gamestate.streak || 0}`}
              style={{
                fontSize: 28,
                color: '#A855F7',
                fontWeight: 'bold',
              }}
            />
            <TextWidget
              text="day streak"
              style={{
                fontSize: 11,
                color: '#555555',
                marginTop: 4,
              }}
            />
          </FlexWidget>

          {/* Level */}
          <FlexWidget style={{ alignItems: 'flex-end' }}>
            <TextWidget
              text={`Level ${gamestate.level || 1}`}
              style={{
                fontSize: 14,
                color: '#FFFFFF',
                fontWeight: '600',
              }}
            />
            <TextWidget
              text={`${gamestate.xp || 0} XP`}
              style={{
                fontSize: 11,
                color: '#555555',
                marginTop: 4,
              }}
            />
          </FlexWidget>
        </FlexWidget>
      </FlexWidget>
    );
  } catch (error) {
    console.error('Stats widget error:', error);
    return <EmptyStatsWidget />;
  }
}

// Empty state
function EmptyStatsWidget() {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: '#000000',
        borderRadius: 12,
        padding: 16,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <TextWidget
        text="STATS"
        style={{
          fontSize: 13,
          color: '#666666',
          fontWeight: 'bold',
          letterSpacing: 1.5,
          marginBottom: 12,
        }}
      />
      <TextWidget
        text="Log in to view"
        style={{
          fontSize: 14,
          color: '#555555',
        }}
      />
    </FlexWidget>
  );
}
