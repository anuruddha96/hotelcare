import { describe, expect, it } from 'vitest';
import {
  extractPublicAreaSection,
  publicAreaTaskCopy,
  stripManagerMetadata,
} from './publicAreaTasks';

const translations: Record<string, string> = {
  'publicAreaTask.area.staircase.name': 'Staircase',
  'publicAreaTask.area.staircase.instruction': 'Clean the staircase and handrails.',
  'publicAreaTask.area.decorations.name': 'Decorations',
  'publicAreaTask.area.decorations.instruction': 'Dust and clean the decorations.',
  'publicAreaTask.area.storage.name': 'Storage',
  'publicAreaTask.area.storage.instruction': 'Clean and organize the storage area.',
  'publicAreaTask.generic': 'Clean this area.',
};

const t = (key: string) => translations[key] ?? key;

describe('publicAreaTaskCopy', () => {
  it('keeps equal area types distinct by exposing their mapped section', () => {
    const side200 = publicAreaTaskCopy({
      task_name: 'Staircase',
      task_type: 'section_cleaning',
      task_description: 'Mapped section: 200 Side\nClean the staircase connected to the 200 side.',
    }, t);
    const side300 = publicAreaTaskCopy({
      task_name: 'Staircase',
      task_type: 'section_cleaning',
      task_description: 'Mapped section: 300 Side\nClean the staircase connected to the 300 side.',
    }, t);

    expect(side200.title).toBe('Staircase');
    expect(side200.location).toBe('200 Side');
    expect(side300.title).toBe('Staircase');
    expect(side300.location).toBe('300 Side');
  });

  it('preserves specific configured task names instead of collapsing them to a generic translation', () => {
    const copy = publicAreaTaskCopy({
      task_name: 'New-side Decorations',
      task_type: 'section_cleaning',
      task_description: 'Mapped section: 200 Side\nDust and clean the decorations on the new side.',
    }, t);

    expect(copy.title).toBe('New-side Decorations');
    expect(copy.location).toBe('200 Side');
    expect(copy.instruction).toBe('Dust and clean the decorations.');
  });

  it('preserves numbered tasks in the same section', () => {
    const copy = publicAreaTaskCopy({
      task_name: 'Storage 1',
      task_type: 'section_cleaning',
      task_description: 'Mapped section: Ground Floor\nClean and organize the first ground-floor storage area.',
    }, t);

    expect(copy.title).toBe('Storage 1');
    expect(copy.location).toBe('Ground Floor');
  });
});

describe('public-area metadata helpers', () => {
  it('extracts the concise location without leaking the manager label into the instruction', () => {
    const description = 'Mapped section: 300 Side\nClean the staircase connected to the 300 side.';
    expect(extractPublicAreaSection(description)).toBe('300 Side');
    expect(stripManagerMetadata(description)).toBe('Clean the staircase connected to the 300 side.');
  });
});
