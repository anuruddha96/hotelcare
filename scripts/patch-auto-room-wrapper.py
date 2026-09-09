from pathlib import Path

path = Path('src/components/dashboard/AutoRoomAssignment.tsx')
text = path.read_text()
old_import = "import { NextDayAssignmentPlanner } from './NextDayAssignmentPlanner';"
new_import = "import { NextDayAutoRoomAssignmentGate } from './NextDayAutoRoomAssignmentGate';"
if text.count(old_import) != 1:
    raise RuntimeError(f'wrapper import expected once, got {text.count(old_import)}')
text = text.replace(old_import, new_import, 1)
old_return = "    return <NextDayAssignmentPlanner {...props} />;"
new_return = """    return (
      <MotionConfig transformPagePoint={toViewportPoint}>
        <NextDayAutoRoomAssignmentGate {...props} />
      </MotionConfig>
    );"""
if text.count(old_return) != 1:
    raise RuntimeError(f'wrapper tomorrow route expected once, got {text.count(old_return)}')
text = text.replace(old_return, new_return, 1)
path.write_text(text)
print('AutoRoomAssignment tomorrow route now uses the unified Auto Assign board.')
