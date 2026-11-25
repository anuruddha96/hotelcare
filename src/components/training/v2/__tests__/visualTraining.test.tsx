import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { curriculaForRole, findCurriculum, trainingRoleFor } from '../curricula';
import { visualTopics, words } from '../curricula/visualTopics';
import { matchesTrainingTopic, trainingSearchTerms } from '../topicSearch';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

const { hasSeenTraining, trainingReleases } = await import('../trainingReleases');

const model = vi.hoisted(() => ({
  start: vi.fn(), refreshStatuses: vi.fn(),
  next: vi.fn(), finish: vi.fn(), pause: vi.fn(), waiting: false,
  stepIndex: 4, totalSteps: 5, lang: 'hu',
  rect: null as DOMRect | null,
  step: null as import('../types').TrainingStepV2 | null,
  statuses: {} as Record<string, { status: string }>,
  availableCurricula: [] as import('../types').TrainingCurriculum[],
}));

vi.mock('../TrainingV2Provider', () => ({
  useTrainingV2: () => model,
  txt: (text: Record<string, string>, lang: string) => text[lang] || text.en,
}));

const { TrainingCenter } = await import('../TrainingCenter');
const { VisualTrainingCue } = await import('../VisualTrainingCue');

const assignment = findCurriculum('visual_housekeeping_auto_assign')!;
const maintenance = findCurriculum('visual_maintenance_work')!;
const hkLabel = words('Housekeeping', 'Takarítás', 'Limpieza', 'Buồng phòng', 'Өрөө үйлчилгээ', 'Прибирання');

describe('visual training topics', () => {
  it('directs each role to its own work', () => {
    expect(trainingRoleFor({ role: 'manager', access_role: 'reception' })).toBe('reception_manager');
    expect(trainingRoleFor({ role: 'manager', access_role: 'housekeeping_manager' })).toBe('housekeeping_manager');
    expect(curriculaForRole('housekeeping')).not.toContain(assignment);
    expect(curriculaForRole('housekeeping_manager')).toContain(assignment);
    expect(curriculaForRole('maintenance')).toContain(maintenance);
    expect(curriculaForRole('maintenance_manager')).not.toContain(maintenance);
    expect(curriculaForRole('reception').map((c) => c.slug)).not.toContain('visual_reception_supervisor');
    expect(curriculaForRole('reception_manager').map((c) => c.slug)).toContain('visual_reception_supervisor');
  });

  it('keeps new guides to five visual cues with translations in all app languages', () => {
    for (const guide of visualTopics) {
      expect(guide.steps.length).toBeLessThanOrEqual(5);
      expect(Object.values(guide.name)).toHaveLength(6);
      for (const step of guide.steps) {
        expect(step.selector).toBeTruthy();
        expect(Object.values(step.title)).toHaveLength(6);
      }
    }
    expect(assignment.steps.map((step) => step.key)).toEqual(['team', 'open', 'preview', 'review', 'publish']);
    expect(assignment.steps.at(-1)?.advanceOnClick).toBeUndefined();
  });

  it('finds an accented or unaccented Hungarian how-to and matches other app languages', () => {
    for (const query of [
      'Hogyan osszam ki automatikusan a szobákat?',
      'hogyan osszam ki automatikusan a szobakat',
      'How do I auto assign',
      'Cómo asignar habitaciones',
      'Cách phân công phòng',
      'Як розподілити номери',
      'Яаж автоматаар хуваарилах',
    ]) expect(matchesTrainingTopic(assignment, hkLabel, trainingSearchTerms(query)), query).toBe(true);
    expect(matchesTrainingTopic(assignment, hkLabel, trainingSearchTerms('Hogyan indítsak javítást?'))).toBe(false);
  });

  it('requires unique immutable release IDs pointing to valid visual guides', () => {
    expect(new Set(trainingReleases.map((release) => release.id)).size).toBe(trainingReleases.length);
    for (const release of trainingReleases) {
      expect(release.id).toMatch(/^[a-z0-9][a-z0-9_-]{2,99}$/);
      expect(findCurriculum(release.curriculum)?.shortTopic).toBe(true);
    }
  });

  it('treats existing completion, including the previous guide, as already watched', () => {
    expect(hasSeenTraining(assignment, { [assignment.slug]: { status: 'done' } })).toBe(true);
    expect(hasSeenTraining(assignment, { v2_promo_auto_assign: { status: 'done' } })).toBe(true);
    expect(hasSeenTraining(assignment, { [assignment.slug]: { status: 'in_progress' } })).toBe(false);
  });

  it('opens a module or finds a standalone topic directly from localized search', () => {
    model.availableCurricula = [assignment, maintenance];
    render(<TrainingCenter />);
    expect(screen.queryByText(assignment.name.hu!)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Takarítás/ }));
    expect(screen.getByText(assignment.name.hu!)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Hogyan osszam ki a szobákat?' } });
    fireEvent.click(screen.getByRole('button', { name: /Szobák automatikus kiosztása/ }));
    expect(model.start).toHaveBeenCalledWith(assignment.slug, { manual: true });
  });

  it('places the guide inside the live modal and finishes training without changing assignments', () => {
    const commit = vi.fn();
    model.step = assignment.steps.at(-1)!;
    const dialog = document.createElement('section');
    dialog.setAttribute('role', 'dialog');
    dialog.dataset.state = 'open';
    const target = document.createElement('button');
    target.dataset.training = 'auto-assign-publish';
    target.textContent = 'Confirm & assign';
    target.onclick = commit;
    dialog.append(target);
    document.body.append(dialog);
    const view = render(<VisualTrainingCue />);
    try {
      const cue = within(dialog).getByRole('complementary');
      expect(cue).toHaveTextContent(model.step.title.hu!);
      fireEvent.click(within(cue).getByRole('button', { name: 'Kész' }));
      expect(model.finish).toHaveBeenCalledOnce();
      expect(commit).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      dialog.remove();
    }
  });
});
