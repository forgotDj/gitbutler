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
	const getInitialData: typeof getInitialDataProp = useEffectEvent(
		(args) => getInitialDataProp?.(args) ?? {},
	);
	const canDrag: typeof canDragProp = useEffectEvent((args) => canDragProp?.(args) ?? true);
	const onDragStart: typeof onDragStartProp = useEffectEvent((args) => onDragStartProp?.(args));
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

type GetDataParams = Parameters<NonNullable<DropTargetParams["getData"]>>;

export const useDroppable = <TData extends Record<string | symbol, unknown>>({
	getData: getDataProp,
	onActiveTargetDrag: onActiveTargetDragProp,
}: {
	getData: (...args: GetDataParams) => TData | null;
	onActiveTargetDrag: DropTargetParams["onDrag"];
}): [boolean, RefCallback<HTMLElement>] => {
	const ref = useRef<HTMLElement>(null);
	const [isActiveDropTarget, setIsActiveDropTarget] = useState<boolean>(false);
	const onActiveTargetDrag: typeof onActiveTargetDragProp = useEffectEvent((args) =>
		onActiveTargetDragProp?.(args),
	);
	const getData: typeof getDataProp = useEffectEvent((args) => getDataProp(args));
	const canDrop: DropTargetParams["canDrop"] = useEffectEvent((args) => getData(args) !== null);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;

		return dropTargetForElements({
			element,
			getData: (args) => getData(args) ?? {},
			canDrop,
			onDrag: (args) => {
				const [innerMost] = args.location.current.dropTargets;

				const isActiveDropTarget = innerMost?.element === args.self.element;

				setIsActiveDropTarget(isActiveDropTarget);

				if (isActiveDropTarget) onActiveTargetDrag(args);
			},
			onDragLeave: () => {
				setIsActiveDropTarget(false);
			},
			onDrop: () => {
				setIsActiveDropTarget(false);
			},
		});
	}, []);

	return [
		isActiveDropTarget,
		(element) => {
			ref.current = element;
		},
	];
};
