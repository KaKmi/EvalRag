import * as React from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
}

function Empty({ className, icon, title = "暂无数据", description, ...props }: EmptyProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 text-center text-muted-foreground",
        className,
      )}
      {...props}
    >
      <div className="mb-3 text-muted-foreground/40">{icon ?? <Inbox className="h-10 w-10" />}</div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 text-xs">{description}</p>}
    </div>
  );
}

export { Empty };
