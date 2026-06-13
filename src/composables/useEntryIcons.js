import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import * as kdbxweb from 'kdbxweb';
import { getField, normalizeHttpUrl } from '../utils';
import { useStore } from '../store';

export function useEntryIcons(emit) {
    const store = useStore();

    async function downloadIcon(entry) {
        const url = normalizeHttpUrl(getField(entry, 'URL'));
        if (!url) return;

        try {
            const domain = new URL(url).hostname;
            const res = await tauriFetch(`https://icon.horse/icon/${domain}`);
            
            if (!res.ok) throw new Error('Icon fetch failed');
            
            const buffer = await res.arrayBuffer();
            if (buffer.byteLength > 0 && store.db) {
                const uuid = kdbxweb.KdbxUuid.random();
                store.db.meta.customIcons.set(uuid.id, { data: buffer });
                entry.customIcon = uuid;
                entry.times.update();
                emit('updated');
            }
        } catch (e) {
            console.error('Failed to fetch icon', e);
        }
    }

    return {
        downloadIcon
    };
}
