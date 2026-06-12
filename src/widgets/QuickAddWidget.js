import { FlexWidget, TextWidget } from 'react-native-android-widget';

/**
 * Quick Add Widget
 * Big button to quickly add a task
 * Opens app to Today screen with add task modal
 */
export async function QuickAddWidget(props) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      clickActionData={{ screen: 'Today', action: 'quickAdd' }}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: '#000000',
        borderRadius: 12,
        borderWidth: 2,
        borderColor: '#A855F7',
        padding: 16,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {/* Large Plus */}
      <TextWidget
        text="+"
        style={{
          fontSize: 56,
          color: '#A855F7',
          fontWeight: 'bold',
          lineHeight: 56,
        }}
      />
      
      {/* Label */}
      <TextWidget
        text="ADD TASK"
        style={{
          fontSize: 11,
          color: '#A855F7',
          fontWeight: 'bold',
          letterSpacing: 1.2,
          marginTop: 12,
        }}
      />
    </FlexWidget>
  );
}
