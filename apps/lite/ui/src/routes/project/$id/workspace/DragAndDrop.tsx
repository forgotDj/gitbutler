import {
	draggable,
	dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { centerUnderPointer } from "@atlaskit/pragmatic-drag-and-drop/element/center-under-pointer";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import {
	type ReactNode,
	type RefCallback,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";

type DraggableParams = Parameters<typeof draggable>[0];

export const useDraggable = ({
	getInitialData: getInitialDataProp,
	canDrag: canDragProp,
	preview,
}: Pick<DraggableParams, "canDrag" | "getInitialData"> & {
	preview: ReactNode;
}): [boolean, RefCallback<HTMLElement>] => {
	const ref = useRef<HTMLElement>(null);
	const [isDragging, setIsDragging] = useState(false);
	const getInitialData: DraggableParams["getInitialData"] = useEffectEvent(
		(args) => getInitialDataProp?.(args) ?? {},
	);
	const canDrag: DraggableParams["canDrag"] = useEffectEvent((args) => canDragProp?.(args) ?? true);
	const onGenerateDragPreview = useEffectEvent(
		({ nativeSetDragImage }: { nativeSetDragImage: DataTransfer["setDragImage"] | null }) => {
			setCustomNativeDragPreview({
				nativeSetDragImage,
				getOffset: centerUnderPointer,
				render: ({ container }) => {
					const root = createRoot(container);
					root.render(preview);
					return () => {
						root.unmount();
					};
				},
			});
		},
	);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;

		return draggable({
			element,
			canDrag,
			getInitialData,
			onGenerateDragPreview,
			onDragStart: () => {
				setIsDragging(true);
			},
			onDrop: () => {
				setIsDragging(false);
			},
		});
	}, []);

	return [
		isDragging,
		(element) => {
			ref.current = element;
		},
	];
};

type DropTargetParams = Parameters<typeof dropTargetForElements>[0];
export type GetDataParams = Parameters<NonNullable<DropTargetParams["getData"]>>;

export const useDroppable = <TData extends Record<string | symbol, unknown>>(
	getDataProp: (...args: GetDataParams) => TData | null,
): [TData | null, RefCallback<HTMLElement>] => {
	const ref = useRef<HTMLElement>(null);
	const [data, setData] = useState<TData | null>(null);
	const getData = useEffectEvent((...args: GetDataParams) => getDataProp(...args));
	const canDrop: DropTargetParams["canDrop"] = useEffectEvent((args) => getData(args) !== null);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;

		return dropTargetForElements({
			element,
			canDrop,
			getData: (args) => getData(args) ?? {},
			onDragEnter: ({ self }) => {
				setData(self.data as TData);
			},
			onDrag: ({ self }) => {
				setData(self.data as TData);
			},
			onDragLeave: () => {
				setData(null);
			},
			onDrop: () => {
				setData(null);
			},
		});
	}, []);

	return [
		data,
		(element) => {
			ref.current = element;
		},
	];
};
