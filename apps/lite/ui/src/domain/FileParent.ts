export type FileParent =
	| {
			_tag: "Commit";
			commitId: string;
	  }
	| {
			_tag: "ChangesSection";
			stackId: string | null;
	  };
