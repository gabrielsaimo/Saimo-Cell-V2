import type { Channel, ChannelStream } from '../types';
import offlineData from '../offiline.json';
import { registerChannel } from '../services/epgService';

interface RawStream {
    url: string;
    quality?: string;
    headers?: Record<string, string>;
}

interface RawChannel {
    id: number | string;
    name: string;
    category: string;
    logo: string;
    drm_system?: { clearKey?: string; widevine?: string };
    streams?: RawStream[];
}

const raw = (offlineData as { data: RawChannel[] }).data;

function slug(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

const mapped: Channel[] = raw.map((c) => {
    const streams: ChannelStream[] = (c.streams ?? []).map(s => ({
        url: s.url,
        quality: s.quality,
        headers: s.headers,
    }));
    const primary = streams[0];
    return {
        id: `${slug(c.name)}-${c.id}`,
        name: c.name,
        url: primary?.url ?? '',
        category: c.category,
        logo: c.logo || '',
        drm: c.drm_system && (c.drm_system.clearKey || c.drm_system.widevine)
            ? { clearKey: c.drm_system.clearKey, widevine: c.drm_system.widevine }
            : undefined,
        headers: primary?.headers,
        streams,
    };
});

export const categoryOrder: string[] = Array.from(new Set(mapped.map(c => c.category)));

const allChannels: Channel[] = mapped.map((ch, index) => ({
    ...ch,
    channelNumber: index + 1,
}));

// Registra canais no serviço de EPG (XMLTV match por nome)
allChannels.forEach(c => registerChannel(c.id, c.name));

// offiline.json não contém categoria 'Adulto'; mantida API por compatibilidade
export const channels: Channel[] = allChannels.filter(ch => ch.category !== 'Adulto');
export const adultChannels: Channel[] = allChannels.filter(ch => ch.category === 'Adulto');

export const getAllChannels = (includeAdult: boolean): Channel[] => {
    return includeAdult ? allChannels : channels;
};

export const getChannelsByCategory = (category: string, includeAdult: boolean): Channel[] => {
    const allChs = getAllChannels(includeAdult);
    if (category === 'Todos') return allChs;
    return allChs.filter(ch => ch.category === category);
};

export const getChannelById = (id: string): Channel | undefined => {
    return allChannels.find(ch => ch.id === id);
};
