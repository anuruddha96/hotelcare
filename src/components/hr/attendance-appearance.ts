// Presentation only: keep role and property identifiers separate from authorization.
export const attendanceGrid='grid grid-cols-2 gap-x-3 gap-y-2 lg:grid-cols-[minmax(190px,2fr)_repeat(4,minmax(70px,0.75fr))_minmax(130px,1.1fr)_minmax(100px,0.8fr)]';

const roleColors:Record<string,string>={
 '':'border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100',
 housekeeping:'border-teal-300 bg-teal-100 text-teal-900 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-200',
 maintenance:'border-orange-300 bg-orange-100 text-orange-900 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-200',
 reception:'border-blue-300 bg-blue-100 text-blue-900 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200',
 front_office_manager:'border-indigo-300 bg-indigo-100 text-indigo-900 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200',
 housekeeping_manager:'border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200',
 housekeeping_supervisor:'border-cyan-300 bg-cyan-100 text-cyan-900 dark:border-cyan-700 dark:bg-cyan-950 dark:text-cyan-200',
 breakfast:'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200',
 manager:'border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200',
 top_management:'border-fuchsia-300 bg-fuchsia-100 text-fuchsia-900 dark:border-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-200',
 hr:'border-rose-300 bg-rose-100 text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200',
 controlling:'border-lime-300 bg-lime-100 text-lime-900 dark:border-lime-700 dark:bg-lime-950 dark:text-lime-200',
 admin:'border-zinc-400 bg-zinc-200 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100',
 other:'border-stone-300 bg-stone-100 text-stone-800 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100',
};
export const roleTone=(key:string)=>roleColors[key]??roleColors.other;

type PropertyTone={header:string;soft:string;border:string};
// Match the existing workforce schedule property identities: Mika green,
// Memories pink, Gozsdu teal, Ottofiori purple. The darker header shades
// support white text in both themes.
const propertyColors:Record<string,PropertyTone>={
 'mika-downtown':{header:'bg-emerald-800 text-white dark:bg-emerald-800',soft:'border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200',border:'border-emerald-300 dark:border-emerald-800'},
 'memories-budapest':{header:'bg-fuchsia-800 text-white dark:bg-fuchsia-800',soft:'border-fuchsia-300 bg-fuchsia-100 text-fuchsia-900 dark:border-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-200',border:'border-fuchsia-300 dark:border-fuchsia-800'},
 'gozsdu-court':{header:'bg-teal-800 text-white dark:bg-teal-800',soft:'border-teal-300 bg-teal-100 text-teal-900 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-200',border:'border-teal-300 dark:border-teal-800'},
 ottofiori:{header:'bg-violet-800 text-white dark:bg-violet-800',soft:'border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200',border:'border-violet-300 dark:border-violet-800'},
};
const fallback:PropertyTone={header:'bg-slate-700 text-white dark:bg-slate-800',soft:roleColors.other,border:'border-slate-300 dark:border-slate-700'};
export const propertyTone=(key:string)=>propertyColors[key]??fallback;

const statusColors:Record<string,string>={
 working:'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
 out:'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
 break:'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
 auto:'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
 forgotten:'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
 missing:'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
};
export const statusTone=(key:string)=>statusColors[key]??'bg-muted text-muted-foreground';
export const metricTones=[
 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-100',
 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-100',
 'border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-100',
 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100',
] as const;
