import * as React from 'react';
import { Platform, ScrollView } from 'react-native';

/** Web mouse wheel → horizontal scroll for ScrollView */
export function useWebHorizontalScroll() {
    const scrollRef = React.useRef<ScrollView>(null);
    const scrollOffsetRef = React.useRef(0);
    const contentWidthRef = React.useRef(0);
    const containerWidthRef = React.useRef(0);
    const handleWheel = React.useCallback((e: any) => {
        if (Platform.OS !== 'web' || !scrollRef.current) return;
        const deltaX = Number(e.deltaX || 0);
        const deltaY = Number(e.deltaY || 0);
        const hasHorizontalIntent = Math.abs(deltaX) > Math.abs(deltaY) || !!e.shiftKey;
        if (!hasHorizontalIntent) return;

        const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
        if (delta === 0) return;
        const maxScroll = Math.max(0, contentWidthRef.current - containerWidthRef.current);
        if (maxScroll <= 0) return;
        const next = Math.min(maxScroll, Math.max(0, scrollOffsetRef.current + delta));
        if (next === scrollOffsetRef.current) return;
        e.preventDefault();
        scrollOffsetRef.current = next;
        (scrollRef.current as any).scrollTo({ x: next, animated: false });
    }, []);
    const scrollViewProps = {
        ref: scrollRef,
        onScroll: (e: any) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.x; },
        scrollEventThrottle: 16,
        onContentSizeChange: (w: number) => { contentWidthRef.current = w; },
        onLayout: (e: any) => { containerWidthRef.current = e.nativeEvent.layout.width; },
    };
    const wheelProps = Platform.OS === 'web' ? { onWheel: handleWheel } as any : {};
    return { scrollViewProps, wheelProps };
}
