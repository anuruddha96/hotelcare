import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Languages, Search, Save, Download, Upload } from 'lucide-react';
import { additionalTranslations } from '@/lib/comprehensive-translations';

interface Translation {
  key: string;
  en: string;
  hu?: string;
  mn?: string;
  es?: string;
  vi?: string;
}

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'hu', name: 'Hungarian', flag: '🇭🇺' },
  { code: 'mn', name: 'Mongolian', flag: '🇲🇳' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'vi', name: 'Vietnamese', flag: '🇻🇳' },
];

export function TranslationManagement() {
  const { profile } = useAuth();
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [filteredTranslations, setFilteredTranslations] = useState<Translation[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('hu');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Check if user is admin or super admin
  const isAdmin = profile?.role === 'admin' || profile?.is_super_admin;

  useEffect(() => {
    loadTranslations();
  }, []);

  useEffect(() => {
    // Filter translations based on search
    if (searchTerm) {
      const filtered = translations.filter(t => 
        t.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.en.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t[selectedLanguage as keyof Translation] as string || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredTranslations(filtered);
    } else {
      setFilteredTranslations(translations);
    }
  }, [searchTerm, translations, selectedLanguage]);

  const loadTranslations = () => {
    try {
      // Load translations from the comprehensive translations file
      const translationKeys = Object.keys(additionalTranslations.en);
      const translationData: Translation[] = translationKeys
        .filter(key => {
          // Skip nested objects - only include string translations
          const value = additionalTranslations.en[key as keyof typeof additionalTranslations.en];
          return typeof value === 'string';
        })
        .map(key => ({
          key,
          en: additionalTranslations.en[key as keyof typeof additionalTranslations.en] as string,
          hu: additionalTranslations.hu?.[key as keyof typeof additionalTranslations.hu] as string,
          mn: additionalTranslations.mn?.[key as keyof typeof additionalTranslations.mn] as string,
          es: additionalTranslations.es?.[key as keyof typeof additionalTranslations.es] as string,
          vi: additionalTranslations.vi?.[key as keyof typeof additionalTranslations.vi] as string,
        }));

      // Load custom translations from localStorage
      const customTranslations = localStorage.getItem('custom_translations');
      if (customTranslations) {
        const custom = JSON.parse(customTranslations);
        translationData.forEach(t => {
          if (custom[t.key]) {
            Object.assign(t, custom[t.key]);
          }
        });
      }

      setTranslations(translationData);
      setFilteredTranslations(translationData);
    } catch (error) {
      console.error('Error loading translations:', error);
      toast.error('Failed to load translations');
    }
  };

  const handleEdit = (key: string, currentValue: string) => {
    setEditingKey(key);
    setEditValue(currentValue || '');
  };

  const handleSave = (key: string) => {
    const updatedTranslations = translations.map(t => {
      if (t.key === key) {
        return {
          ...t,
          [selectedLanguage]: editValue
        };
      }
      return t;
    });

    setTranslations(updatedTranslations);
    setEditingKey(null);
    setHasUnsavedChanges(true);
    toast.success('Translation updated (not saved yet)');
  };

  const handleSaveAll = () => {
    try {
      // Save custom translations to localStorage
      const customTranslations: any = {};
      translations.forEach(t => {
        customTranslations[t.key] = {
          en: t.en,
          hu: t.hu,
          mn: t.mn,
          es: t.es,
          vi: t.vi,
        };
      });

      localStorage.setItem('custom_translations', JSON.stringify(customTranslations));
      setHasUnsavedChanges(false);
      toast.success('All translations saved successfully!');
      
      // Trigger a reload to apply new translations
      window.location.reload();
    } catch (error) {
      console.error('Error saving translations:', error);
      toast.error('Failed to save translations');
    }
  };

  const exportTranslations = () => {
    try {
      const exportData = {
        timestamp: new Date().toISOString(),
        translations: translations.reduce((acc, t) => {
          acc[t.key] = {
            en: t.en,
            hu: t.hu,
            mn: t.mn,
            es: t.es,
            vi: t.vi,
          };
          return acc;
        }, {} as any)
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `translations-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      toast.success('Translations exported successfully!');
    } catch (error) {
      console.error('Error exporting translations:', error);
      toast.error('Failed to export translations');
    }
  };

  const importTranslations = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target?.result as string);
        const importedTranslations = importData.translations;
        
        const updatedTranslations = translations.map(t => {
          if (importedTranslations[t.key]) {
            return {
              ...t,
              ...importedTranslations[t.key]
            };
          }
          return t;
        });

        setTranslations(updatedTranslations);
        setHasUnsavedChanges(true);
        toast.success('Translations imported successfully!');
      } catch (error) {
        console.error('Error importing translations:', error);
        toast.error('Failed to import translations');
      }
    };
    reader.readAsText(file);
  };

  if (!isAdmin) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">Access denied. Only admins can manage translations.</p>
      </Card>
    );
  }

  const missingTranslations = filteredTranslations.filter(t => !t[selectedLanguage as keyof Translation]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Languages className="h-6 w-6" />
            Translation Management
          </h2>
          <p className="text-muted-foreground mt-1">
            Manage all translations for the application
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={exportTranslations} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <label htmlFor="import-translations">
            <Button variant="outline" size="sm" asChild>
              <span>
                <Upload className="h-4 w-4 mr-2" />
                Import
              </span>
            </Button>
          </label>
          <input
            id="import-translations"
            type="file"
            accept=".json"
            onChange={importTranslations}
            className="hidden"
          />
          {hasUnsavedChanges && (
            <Button onClick={handleSaveAll} size="sm">
              <Save className="h-4 w-4 mr-2" />
              Save All Changes
            </Button>
          )}
        </div>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search translations..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Stats */}
          <div className="flex gap-4 flex-wrap">
            <Badge variant="secondary">
              Total: {filteredTranslations.length} phrases
            </Badge>
            {missingTranslations.length > 0 && (
              <Badge variant="destructive">
                Missing: {missingTranslations.length} translations
              </Badge>
            )}
          </div>

          {/* Translations List */}
          <div className="border rounded-lg overflow-hidden">
            <div className="max-h-[600px] overflow-y-auto">
              <table className="w-full">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-3 font-semibold w-1/3">Key</th>
                    <th className="text-left p-3 font-semibold w-1/3">English</th>
                    <th className="text-left p-3 font-semibold w-1/3">
                      {LANGUAGES.find(l => l.code === selectedLanguage)?.name}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTranslations.map((translation, index) => {
                    const isEditing = editingKey === translation.key;
                    const currentValue = translation[selectedLanguage as keyof Translation] as string || '';
                    const isMissing = !currentValue;

                    return (
                      <tr 
                        key={translation.key} 
                        className={`border-b hover:bg-accent/30 ${isMissing ? 'bg-destructive/5' : ''}`}
                      >
                        <td className="p-3">
                          <code className="text-xs bg-muted px-2 py-1 rounded">
                            {translation.key}
                          </code>
                        </td>
                        <td className="p-3 text-sm">{translation.en}</td>
                        <td className="p-3">
                          {isEditing ? (
                            <div className="flex gap-2">
                              <Textarea
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="min-h-[60px]"
                                autoFocus
                              />
                              <div className="flex flex-col gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleSave(translation.key)}
                                >
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setEditingKey(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div 
                              className={`cursor-pointer hover:bg-accent/50 p-2 rounded ${isMissing ? 'text-muted-foreground italic' : ''}`}
                              onClick={() => handleEdit(translation.key, currentValue)}
                            >
                              {currentValue || 'Click to add translation...'}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
