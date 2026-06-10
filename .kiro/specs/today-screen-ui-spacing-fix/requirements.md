# Requirements Document: TodayScreen UI Spacing and Visual Design Fixes

## Introduction

This document specifies the requirements for fixing UI spacing and visual design issues in the TodayScreen component. The feature addresses excessive bottom spacing, FAB positioning problems, and enhances the bottom input area with improved glassmorphism and visual hierarchy to create a polished, professional user interface that matches the quality of existing task cards.

## Glossary

- **FAB**: Floating Action Button - The circular "+" button used to add new tasks
- **Bottom_Input_Area**: The expanded card-like interface that appears when adding a new task, containing input field, toolbar buttons, and pending tags
- **Task_List**: The scrollable vertical list of task cards
- **Glassmorphism**: Design style using semi-transparent backgrounds with blur effects to create a glass-like appearance
- **Safe_Area**: Platform-specific screen regions that must not be obscured by UI elements (notches, home indicators, gesture bars)
- **Toolbar**: The row of buttons (Due date, Remind me, Repeat) in the Bottom_Input_Area
- **Touch_Target**: The minimum interactive area size for touchable elements (44x44 pixels)

## Requirements

### Requirement 1: Reduce Excessive Bottom Spacing

**User Story:** As a user, I want the task list to extend closer to the bottom action zone, so that I can see more tasks without excessive white space.

#### Acceptance Criteria

1. THE ScrollView SHALL have paddingBottom of 16 pixels
2. WHEN the task list is displayed, THE gap between the last visible task and the FAB SHALL be minimal while maintaining readability
3. WHEN scrolling to the bottom of the task list, THE last task SHALL remain visible with at least 16 pixels of clearance above the FAB or Bottom_Input_Area
4. THE reduced spacing SHALL NOT cause content occlusion when the Bottom_Input_Area is opened

---

### Requirement 2: Optimize FAB Positioning

**User Story:** As a user, I want the add button positioned optimally for thumb reach, so that I can quickly add tasks without stretching.

#### Acceptance Criteria

1. THE FAB SHALL be positioned at 16 pixels from the bottom edge of the screen
2. THE FAB SHALL be positioned at 20 pixels from the right edge of the screen
3. ON iOS devices with safe area insets, THE FAB bottom position SHALL respect safe area boundaries
4. THE FAB position SHALL maintain sufficient clearance for gesture navigation on modern Android devices

---

### Requirement 3: Enhance Bottom Input Area Visual Design

**User Story:** As a user, I want the task input area to look polished and professional, so that the UI feels cohesive and high-quality throughout.

#### Acceptance Criteria

1. THE Bottom_Input_Area SHALL use a semi-transparent background color of rgba(30, 30, 30, 0.95)
2. THE Bottom_Input_Area SHALL have a top border of 1 pixel with color rgba(255, 255, 255, 0.08)
3. THE Bottom_Input_Area SHALL have border radius of 24 pixels on top corners
4. THE Bottom_Input_Area SHALL have paddingTop of 20 pixels
5. THE Bottom_Input_Area SHALL have paddingHorizontal of 16 pixels
6. ON iOS devices, THE Bottom_Input_Area SHALL have paddingBottom of 32 pixels
7. ON Android devices, THE Bottom_Input_Area SHALL have paddingBottom of 20 pixels
8. THE Bottom_Input_Area SHALL have shadow with offset (0, -8), opacity 0.4, and radius 16
9. ON iOS devices, THE Bottom_Input_Area SHALL use backdrop blur filter of 20 pixels
10. ON Android devices, THE Bottom_Input_Area SHALL use elevation of 24

---

### Requirement 4: Improve Input Row Spacing

**User Story:** As a user, I want the input field and buttons to be properly spaced, so that the interface feels organized and professional.

#### Acceptance Criteria

1. THE Input_Row SHALL have paddingHorizontal of 20 pixels
2. THE Input_Row SHALL have paddingVertical of 8 pixels
3. THE Input_Row SHALL have marginBottom of 16 pixels
4. THE Input_Row SHALL have consistent gap of 12 pixels between child elements
5. ALL interactive elements in the Input_Row SHALL meet minimum Touch_Target size of 44x44 pixels

---

### Requirement 5: Enhance Toolbar Spacing

**User Story:** As a user, I want the toolbar buttons to have adequate spacing, so that I can tap them accurately without mistakes.

#### Acceptance Criteria

1. THE Toolbar SHALL have paddingHorizontal of 20 pixels
2. THE Toolbar SHALL have paddingBottom of 8 pixels
3. THE Toolbar SHALL have gap of 20 pixels between toolbar buttons
4. THE Toolbar horizontal padding SHALL align with Input_Row horizontal padding

---

### Requirement 6: Handle Safe Areas Correctly

**User Story:** As an iOS user with a device that has a notch or dynamic island, I want the input area to respect safe areas, so that content doesn't overlap with system UI elements.

#### Acceptance Criteria

1. WHEN safe area bottom inset is greater than 0, THE Bottom_Input_Area paddingBottom SHALL be at least (safe_area_inset + 8) pixels
2. ON iOS devices, THE Bottom_Input_Area SHALL use Math.max(insets.bottom + 8, 32) for paddingBottom calculation
3. THE FAB bottom position SHALL account for safe area insets to prevent overlap with home indicator

---

### Requirement 7: Maintain Visual Hierarchy

**User Story:** As a user, I want the input area to have clear visual importance, so that I understand it's an active interaction zone.

#### Acceptance Criteria

1. WHEN Bottom_Input_Area is visible, THE shadow depth SHALL be equal to or greater than task card shadows
2. THE Bottom_Input_Area SHALL have glassmorphism effects (semi-transparent background, top border, blur) to match the visual style of task cards
3. THE visual weight of Bottom_Input_Area SHALL clearly distinguish it as the primary interaction zone

---

### Requirement 8: Support Cross-Platform Consistency

**User Story:** As a developer, I want platform-specific styling to be handled automatically, so that the UI looks appropriate on both iOS and Android.

#### Acceptance Criteria

1. WHERE Platform.OS === 'ios', THE Bottom_Input_Area SHALL use backdropFilter blur effect
2. WHERE Platform.OS === 'android', THE Bottom_Input_Area SHALL use elevation for shadow depth
3. WHERE Platform.OS === 'ios', THE Bottom_Input_Area paddingBottom SHALL be 32 pixels
4. WHERE Platform.OS === 'android', THE Bottom_Input_Area paddingBottom SHALL be 20 pixels
5. THE styling differences SHALL maintain visual consistency across platforms

---

### Requirement 9: Ensure Content Visibility

**User Story:** As a user with many tasks, I want all my tasks to remain accessible, so that I can view and interact with every task in my list.

#### Acceptance Criteria

1. WHEN scrolling to the bottom of the Task_List, THE last task SHALL be fully visible
2. WHEN the Bottom_Input_Area is opened, THE Task_List SHALL adjust to maintain last task visibility
3. THE ScrollView paddingBottom SHALL prevent the last task from being obscured by the FAB
4. WHEN the FAB is visible, THE last task SHALL have at least 16 pixels of vertical clearance above it

---

### Requirement 10: Prevent Layout Thrashing

**User Story:** As a user, I want smooth transitions between FAB and input modes, so that the UI feels responsive and fluid.

#### Acceptance Criteria

1. WHEN transitioning from FAB to Bottom_Input_Area, THE style changes SHALL be batched to minimize re-renders
2. THE transition animation SHALL maintain 60 fps (frame time < 16ms)
3. THE Bottom_Input_Area render time SHALL be less than 50ms on mid-range devices

---

### Requirement 11: Maintain Design System Consistency

**User Story:** As a designer, I want spacing values to follow the design system, so that the UI maintains mathematical consistency.

#### Acceptance Criteria

1. ALL padding values SHALL be multiples of 4 pixels
2. ALL gap values SHALL be multiples of 4 pixels
3. ALL border radius values SHALL be multiples of 4 pixels
4. THE spacing values SHALL create visual rhythm and consistency throughout the component
