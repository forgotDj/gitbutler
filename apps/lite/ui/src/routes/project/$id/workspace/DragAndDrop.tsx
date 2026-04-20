import { type Operation, useRunOperation } from "#ui/Operation.ts";
import {
	draggable,
	dropTargetForElements,
	monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { centerUnderPointer } from "@atlaskit/pragmatic-drag-and-drop/element/center-under-pointer";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import {
	FC,
	type ReactNode,
	type RefCallback,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import styles from "./DragAndDrop.module.css";
import { type OperationSource } from "./OperationSource.ts";

export type DragData = {
	source: OperationSource;
};

export const parseDragData = (data: unknown): DragData | null => {
	if (typeof data !== "object" || data === null || !("source" in data)) return null;
	return data as DragData;
};

export type DropData = {
	operation: Operation | null;
	source: OperationSource;
} | null;

const parseDropData = (data: unknown): DropData | null => {
	if (typeof data !== "object" || data === null || !("operation" in data)) return null;
	return data as DropData;
};

export const DragPreview: FC<{ children: ReactNode }> = ({ children }) => (
	<div className={styles.dragPreview}>{children}</div>
);

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

export const useMonitorDraggedOperationSource = ({ projectId }: { projectId: string }) => {
	const runOperation = useRunOperation();

	useEffect(
		() =>
			monitorForElements({
				canMonitor: ({ source }) => parseDragData(source.data) !== null,
				onDrop: ({ location }) => {
					const dropData = location.current.dropTargets
						.map((dropTarget) => parseDropData(dropTarget.data))
						.find((target) => target);

					if (!dropData?.operation) return;

					runOperation(projectId, dropData.operation);
				},
			}),
		[runOperation, projectId],
	);
};
