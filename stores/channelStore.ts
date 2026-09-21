import { create } from 'zustand';
import type { Channel, CategoryId } from '../types';
import { setRemoteChannels } from '../data/channels';
import { plutoIdDe, registerChannel } from '../services/epgService';
import { loadRemoteChannels } from '../services/saimoSources';
import { atualizar as atualizarFontesDesativadas, VALIDADE_MS as FONTES_MS } from '../services/fontesDesativadas';

function sortKey(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

interface ChannelStore {
    // Estado
    selectedCategory: CategoryId | 'Todos' | 'Favoritos' | string;
    currentChannelId: string | null;
    searchQuery: string;
    isLoading: boolean;
    channels: Channel[];

    // Ações
    setCategory: (category: CategoryId | 'Todos' | 'Favoritos' | string) => void;
    setCurrentChannel: (channelId: string | null) => void;
    setSearchQuery: (query: string) => void;
    setLoading: (loading: boolean) => void;
    fetchChannels: (force?: boolean) => Promise<void>;
    /** Passa a vigiar os servidores desligados no painel. Devolve como parar. */
    vigiarFontesDesativadas: () => () => void;

    // Seletores
    getFilteredChannels: (includeAdult: boolean, favorites: string[]) => Channel[];
    getCategories: (includeAdult: boolean) => string[];
}

export const useChannelStore = create<ChannelStore>((set, get) => ({
    selectedCategory: 'Todos',
    currentChannelId: null,
    searchQuery: '',
    isLoading: false,
    channels: [],

    setCategory: (category) => {
        set({ selectedCategory: category });
    },

    setCurrentChannel: (channelId) => {
        set({ currentChannelId: channelId });
    },

    setSearchQuery: (query) => {
        set({ searchQuery: query });
    },

    setLoading: (loading) => {
        set({ isLoading: loading });
    },

    fetchChannels: async (force = false) => {
        try {
            set({ isLoading: true });
            // A lista de servidores desligados vem antes do catálogo: chegando
            // depois, a tela mostraria por um instante canais que não abrem.
            await atualizarFontesDesativadas();
            // Há uma única lista: catálogo e reservas publicados no Git.
            const data = await loadRemoteChannels(force);
            data.forEach(ch => registerChannel(ch.id, ch.name, plutoIdDe(ch)));
            setRemoteChannels(data);
            set({ channels: data, isLoading: false });
        } catch (error) {
            console.error('Failed to fetch channels:', error);
            set({ isLoading: false });
        }
    },

    /*
     * Um servidor desligado no painel tem que sumir da tela em minutos, que é
     * o tempo que alguém aguenta um canal quebrado — sem fechar o aplicativo.
     * A lista é remontada do que já está em disco (`loadRemoteChannels` sem
     * `force` lê o cache): nada é rebaixado da rede, só o que está morto sai e
     * o que foi religado volta.
     */
    vigiarFontesDesativadas: () => {
        const relogio = setInterval(() => {
            void atualizarFontesDesativadas().then(async (mudou) => {
                if (!mudou) return;
                try {
                    const data = await loadRemoteChannels(false);
                    setRemoteChannels(data);
                    set({ channels: data });
                } catch (error) {
                    console.error('Failed to refilter channels:', error);
                }
            });
        }, FONTES_MS);
        return () => clearInterval(relogio);
    },

    getFilteredChannels: (includeAdult: boolean, favorites: string[]) => {
        const { selectedCategory, searchQuery, channels } = get();

        const base = includeAdult
            ? channels
            : channels.filter(ch => ch.category !== 'ADULTOS' && ch.category !== 'Adulto');
        const categoryOrder = Array.from(new Set(base.map(ch => ch.category)));
        let allChs = [...base].sort((a, b) => {
            const ai = categoryOrder.indexOf(a.category);
            const bi = categoryOrder.indexOf(b.category);
            if (ai !== bi) return ai - bi;
            const an = a.channelNumber ?? 99999;
            const bn = b.channelNumber ?? 99999;
            if (an !== bn) return an - bn;
            const ka = sortKey(a.name), kb = sortKey(b.name);
            return ka.localeCompare(kb);
        });

        // Filtro por categoria ou resolução
        if (selectedCategory === 'Favoritos') {
            allChs = allChs.filter(ch => favorites.includes(ch.id));
        } else if (['4K', 'FHD', 'HD', 'SD'].includes(selectedCategory as string)) {
            const res = (selectedCategory as string).toLowerCase();
            allChs = allChs.filter(ch => {
                const name = ch.name.toLowerCase();
                if (res === '4k') return name.includes('4k');
                if (res === 'fhd') return name.includes('fhd') && !name.includes('4k');
                if (res === 'hd') return (name.includes(' hd') || name.endsWith('hd')) && !name.includes('fhd');
                if (res === 'sd') return name.includes('sd');
                return true;
            });
        } else if (selectedCategory !== 'Todos') {
            allChs = allChs.filter(ch => ch.category === selectedCategory);
        }

        // Filtro por busca
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim();
            allChs = allChs.filter(ch =>
                ch.name.toLowerCase().includes(query) ||
                ch.category.toLowerCase().includes(query)
            );
        }

        return allChs;
    },

    getCategories: (includeAdult: boolean) => {
        const { channels } = get();
        const resolutions = ['4K', 'FHD', 'HD', 'SD'];
        const categories = Array.from(new Set(channels.map(ch => ch.category)));
        const filtered = includeAdult
            ? categories
            : categories.filter(c => c !== 'ADULTOS' && c !== 'Adulto');
        return ['Todos', 'Favoritos', ...resolutions, ...filtered];
    },
}));
