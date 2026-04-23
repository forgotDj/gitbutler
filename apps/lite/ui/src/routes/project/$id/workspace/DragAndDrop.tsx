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
	onDragStart: onDragStartProp,
	preview,
}: Pick<DraggableParams, "canDrag" | "getInitialData" | "onDragStart"> & {
	preview: ReactNode;
}): [boolean, RefCallback<HTMLElement>] => {
	const ref = useRef<HTMLElement>(null);
	const [isDragging, setIsDragging] = useState(false);
	const getInitialData: DraggableParams["getInitialData"] = useEffectEvent(
		(args) => getInitialDataProp?.(args) ?? {},
	);
	const canDrag: DraggableParams["canDrag"] = useEffectEvent((args) => canDragProp?.(args) ?? true);
	const onDragStart: DraggableParams["onDragStart"] = useEffectEvent((args) =>
		onDragStartProp?.(args),
	);
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
			onDragStart: (args) => {
				setIsDragging(true);
				onDragStart(args);
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

export const useDroppable = ({
	getData: getDataProp,
	onDrag: onDragProp,
}: Pick<Required<DropTargetParams>, "getData" | "onDrag">): [boolean, RefCallback<HTMLElement>] => {
	const ref = useRef<HTMLElement>(null);
	const [isDragOver, setIsDragOver] = useState<boolean>(false);
	const onDrag: DropTargetParams["onDrag"] = useEffectEvent((args) => onDragProp(args));
	const getData: DropTargetParams["getData"] = useEffectEvent((args) => getDataProp(args));

	useEffect(() => {
		const element = ref.current;
		if (!element) return;

		return dropTargetForElements({
			element,
			getData,
			onDragEnter: () => {
				setIsDragOver(true);
			},
			onDrag,
			onDragLeave: () => {
				setIsDragOver(false);
			},
			onDrop: () => {
				setIsDragOver(false);
			},
		});
	}, []);

	return [
		isDragOver,
		(element) => {
			ref.current = element;
		},
	];
};
