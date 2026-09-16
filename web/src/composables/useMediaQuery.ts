import { onMounted, onUnmounted, ref } from 'vue';

/** 与 CSS 断点保持一致；只在布局改变时更新，不监听每次 resize。 */
export function useMediaQuery(query: string) {
  const media = window.matchMedia(query);
  const matches = ref(media.matches);
  const update = () => { matches.value = media.matches; };
  onMounted(() => media.addEventListener('change', update));
  onUnmounted(() => media.removeEventListener('change', update));
  return matches;
}
